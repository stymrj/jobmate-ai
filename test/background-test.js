/**
 * test/background-test.js - Background service worker tests.
 *
 * Verifies the changed message routing:
 *  - SAVE_RESUME now stores both structured data and the resume file.
 *  - GET_RESUME_FILE returns the stored resume file.
 *  - startAutofill reports a real error when the target tab has no content
 *    script (instead of silently succeeding).
 *  - AI provider routing: GET_PROVIDERS catalog, provider-aware missing-key
 *    errors, and provider-specific request formats (Gemini/DeepSeek/Claude).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BG_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');

function loadBackground(opts = {}) {
  const storage = new Map();
  let onMessageHandler = null;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    fetch: opts.fetch || (async () => { throw new Error('fetch not used in these tests'); }),
    chrome: {
      storage: {
        local: {
          get: async (key) => {
            if (Array.isArray(key)) {
              const out = {};
              for (const k of key) out[k] = storage.get(k);
              return out;
            }
            return { [key]: storage.get(key) };
          },
          set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
          remove: async (keys) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) storage.delete(k);
          }
        }
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: {
          addListener: (fn) => { onMessageHandler = fn; }
        },
        lastError: null
      },
      tabs: {
        query: async () => [{ id: 42, url: 'https://boards.greenhouse.io/jobs/1' }],
        get: async () => ({ id: 42, url: 'https://boards.greenhouse.io/jobs/1' }),
        sendMessage: (tabId, msg, cb) => {
          let response;
          if (tabId === 42) {
            response = { success: true };
          } else {
            context.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
            response = undefined;
          }
          if (cb) cb(response);
          if (response === undefined && context.chrome.runtime.lastError) {
            const err = context.chrome.runtime.lastError;
            context.chrome.runtime.lastError = null;
            return Promise.reject(err);
          }
          return Promise.resolve(response);
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(BG_SRC, context);

  const send = (msg) =>
    new Promise((resolve, reject) => {
      onMessageHandler(msg, {}, (resp) => resolve(resp));
    });

  return { send, storage };
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

(async () => {
  console.log('=== BG TEST 1: SAVE_RESUME stores data + file ===');
  const bg = loadBackground();
  await bg.send({
    type: 'SAVE_RESUME',
    data: { data: { firstName: 'Jane' }, file: { name: 'resume.pdf', type: 'application/pdf', base64: 'AAAA' } }
  });
  assert(JSON.stringify(bg.storage.get('resumeData')) === JSON.stringify({ firstName: 'Jane' }), 'structured resume stored');
  assert(bg.storage.get('resumeFile').name === 'resume.pdf', 'resume file stored');
  assert(bg.storage.get('resumeFile').base64 === 'AAAA', 'resume file bytes stored');

  console.log('\n=== BG TEST 2: GET_RESUME_FILE returns the file ===');
  const r2 = await bg.send({ type: 'GET_RESUME_FILE' });
  assert(r2.result && r2.result.name === 'resume.pdf', 'GET_RESUME_FILE returns stored file');

  console.log('\n=== BG TEST 3: legacy SAVE_RESUME still works ===');
  const bg3 = loadBackground();
  await bg3.send({ type: 'SAVE_RESUME', data: { firstName: 'Bob' } });
  assert(JSON.stringify(bg3.storage.get('resumeData')) === JSON.stringify({ firstName: 'Bob' }), 'legacy shape accepted');

  console.log('\n=== BG TEST 3b: SAVE_RESUME clears the mapping cache ===');
  const bg3b = loadBackground();
  await bg3b.send({ type: 'SAVE_SETTINGS', data: { apiKey: 'sk-1' } });
  await bg3b.storage.set('mappingCache', { 'x::y': { value: 'z', ts: 1 } });
  await bg3b.send({ type: 'SAVE_RESUME', data: { firstName: 'Jane' } });
  assert(bg3b.storage.get('mappingCache') === undefined, 'mapping cache removed when a new resume is uploaded');

  console.log('\n=== BG TEST 4: startAutofill reaches tab with content script ===');
  const bg4 = loadBackground();
  const r4 = await bg4.send({ type: 'START_AUTOFILL', tabId: 42 });
  assert(r4.result === true, 'startAutofill resolves true when content script responds');

  console.log('\n=== BG TEST 5: startAutofill surfaces missing content script error ===');
  const bg5 = loadBackground();
  const r5 = await bg5.send({ type: 'START_AUTOFILL', tabId: 99 });
  assert(!!r5.error && /No job application form detected/.test(r5.error), 'startAutofill reports a helpful error');

  console.log('\n=== BG TEST 6: GET_PROVIDERS returns the provider catalog ===');
  const bg6 = loadBackground();
  const r6 = await bg6.send({ type: 'GET_PROVIDERS' });
  const ids = r6.result.map((p) => p.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['claude', 'deepseek', 'gemini', 'openai']), 'catalog lists all 4 providers');
  const gemini = r6.result.find((p) => p.id === 'gemini');
  assert(gemini.defaultModel && Array.isArray(gemini.models), 'provider includes default model + model presets');

  console.log('\n=== BG TEST 7: missing API key error names the selected provider ===');
  const bg7 = loadBackground();
  // No admin-shared key either (seeded empty + marked as already seeded).
  bg7.storage.set('adminConfig', { apiKey: '', aiProvider: 'gemini', aiModel: '' });
  bg7.storage.set('adminConfigSeeded', true);
  await bg7.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'gemini' } });
  const r7 = await bg7.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'x' } });
  assert(/Google Gemini API key not configured/.test(r7.error), 'error mentions Google Gemini');

  console.log('\n=== BG TEST 8: Gemini requests use x-goog-api-key + responseMimeType ===');
  let geminiCall = null;
  const bg8 = loadBackground({
    fetch: async (url, opts) => {
      geminiCall = { url, opts };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"firstName":"Gem","lastName":"User"}' }] } }] }) };
    }
  });
  await bg8.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'gemini', apiKey: 'AIzaTEST' } });
  const r8 = await bg8.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'resume text' } });
  assert(r8.result && r8.result.firstName === 'Gem', 'gemini response parsed into resume JSON');
  assert(/generativelanguage\.googleapis\.com/.test(geminiCall.url), 'calls the Generative Language API');
  assert(geminiCall.opts.headers['x-goog-api-key'] === 'AIzaTEST', 'sends x-goog-api-key header');
  const gBody = JSON.parse(geminiCall.opts.body);
  assert(gBody.generationConfig && gBody.generationConfig.responseMimeType === 'application/json', 'requests JSON via responseMimeType');
  assert(gBody.systemInstruction && gBody.systemInstruction.parts[0].text.length > 0, 'system prompt sent as systemInstruction');

  console.log('\n=== BG TEST 9: Claude requests use x-api-key + anthropic-version ===');
  let claudeCall = null;
  const bg9 = loadBackground({
    fetch: async (url, opts) => {
      claudeCall = { url, opts };
      return { ok: true, json: async () => ({ content: [{ text: '{"answer":"Yes","confidence":"high","reasoning":"from resume"}' }] }) };
    }
  });
  await bg9.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'claude', apiKey: 'sk-ant-TEST' } });
  const r9 = await bg9.send({ type: 'AI_REQUEST', action: 'ANSWER_QUESTION', data: { question: 'Authorized?', options: ['Yes', 'No'], resumeData: { authorizedToWork: true } } });
  assert(r9.result && r9.result.answer === 'Yes', 'claude response parsed');
  assert(/api\.anthropic\.com/.test(claudeCall.url), 'calls the Anthropic Messages API');
  assert(claudeCall.opts.headers['x-api-key'] === 'sk-ant-TEST', 'sends x-api-key header');
  assert(claudeCall.opts.headers['anthropic-version'] === '2023-06-01', 'sends anthropic-version header');
  const cBody = JSON.parse(claudeCall.opts.body);
  assert(/valid JSON/.test(cBody.system), 'JSON-only constraint in system prompt');
  assert(Array.isArray(cBody.messages) && cBody.messages[0].role === 'user', 'uses Messages API shape');

  console.log('\n=== BG TEST 10: DeepSeek uses OpenAI-compatible format + response_format ===');
  let dsCall = null;
  const bg10 = loadBackground({
    fetch: async (url, opts) => {
      dsCall = { url, opts };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"firstName":"D","lastName":"S"}' } }] }) };
    }
  });
  await bg10.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'deepseek', apiKey: 'sk-DS' } });
  const r10 = await bg10.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'r' } });
  assert(r10.result && r10.result.firstName === 'D', 'deepseek response parsed');
  assert(/api\.deepseek\.com/.test(dsCall.url), 'calls DeepSeek endpoint');
  const dBody = JSON.parse(dsCall.opts.body);
  assert(dBody.model === 'deepseek-chat', 'defaults to deepseek-chat');
  assert(dBody.response_format.type === 'json_object', 'requests JSON via response_format');

  console.log('\n=== BG TEST 11: custom model override is honored ===');
  let oaCall = null;
  const bg11 = loadBackground({
    fetch: async (url, opts) => {
      oaCall = { url, opts };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"email":"a@b.c"}' } }] }) };
    }
  });
  await bg11.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'openai', aiModel: 'gpt-4.1', apiKey: 'sk-1' } });
  const r11 = await bg11.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'r' } });
  assert(r11.result && r11.result.email === 'a@b.c', 'openai response parsed');
  assert(JSON.parse(oaCall.opts.body).model === 'gpt-4.1', 'custom model sent to the API');

  console.log('\n=== BG TEST 12: admin-shared key is seeded and used when the user has none ===');
  const bg12 = loadBackground({
    fetch: async (url, opts) => {
      assert(/generativelanguage\.googleapis\.com/.test(url), 'shared key routes to the admin provider (gemini)');
      assert(/gemini-2\.0-flash/.test(url), 'defaults to the admin provider default model');
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"firstName":"Shared"}' }] } }] }) };
    }
  });
  // No user key at all — the seeded admin key must be used automatically.
  await bg12.send({ type: 'SAVE_SETTINGS', data: { aiProvider: '' } });
  const r12 = await bg12.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'r' } });
  assert(r12.result && r12.result.firstName === 'Shared', 'admin-shared key used without any user key');
  const s12 = await bg12.send({ type: 'GET_STATUS' });
  assert(s12.result.keySource === 'admin', 'status reports the admin key as the source');

  console.log('\n=== BG TEST 13: the user\'s own key always overrides the admin key ===');
  let bg13UsedAdmin = false;
  const bg13 = loadBackground({
    fetch: async (url, opts) => {
      if (url.includes('api.openai.com')) {
        const sent = JSON.parse(opts.body);
        assert(sent.model === 'gpt-4o-mini', 'defaults to openai model when the user selects openai');
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"email":"own@key.test"}' } }] }) };
      }
      bg13UsedAdmin = true;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
    }
  });
  await bg13.send({ type: 'SAVE_SETTINGS', data: { aiProvider: 'openai', apiKey: 'sk-user-own' } });
  const r13 = await bg13.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'r' } });
  assert(r13.result && r13.result.email === 'own@key.test', 'user key used instead of the admin key');
  assert(bg13UsedAdmin === false, 'the admin key was never used');
  const s13 = await bg13.send({ type: 'GET_STATUS' });
  assert(s13.result.keySource === 'user', 'status reports the user key as the source');

  console.log('\n=== BG TEST 14: admin settings refresh pulls a rotated key from the admin server ===');
  let settingsFetched = false;
  const bg14 = loadBackground({
    fetch: async (url, opts) => {
      if (url.endsWith('/api/admin/settings')) {
        settingsFetched = true;
        return { ok: true, json: async () => ({ apiKey: 'AIzaROTATED', aiProvider: 'gemini', aiModel: '' }) };
      }
      if (url.includes('generativelanguage')) {
        assert(/gemini-2\.0-flash/.test(url), 'still routes to gemini');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"firstName":"Rotated"}' }] } }] }) };
      }
      throw new Error('unexpected URL: ' + url);
    }
  });
  await bg14.send({ type: 'SAVE_SETTINGS', data: { analyticsEndpoint: 'https://api.jobmate-ai.com/api/events' } });
  await bg14.send({ type: 'REFRESH_ADMIN_SETTINGS' });
  assert(settingsFetched, 'admin settings endpoint was queried');
  const r14 = await bg14.send({ type: 'AI_REQUEST', action: 'STRUCTURE_RESUME', data: { rawText: 'r' } });
  assert(r14.result && r14.result.firstName === 'Rotated', 'rotated admin key used after refresh');

  console.log('\nALL BACKGROUND TESTS PASSED');
})().catch((e) => {
  console.error('\nBACKGROUND TEST FAILURE:', e.message);
  console.error(e);
  process.exit(1);
});