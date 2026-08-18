/**
 * background.js - Background Service Worker
 *
 * Manifest V3 service worker that handles:
 * - Message routing between popup and content scripts
 * - AI API calls (OpenAI / Gemini / DeepSeek / Claude — keeps API key
 *   secure in background, provider chosen in the popup settings)
 * - Resume data storage management
 * - Dynamic engine injection for detected job-application pages
 * - Optional anonymous usage analytics (opt-in, batched)
 */

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ result }))
    .catch(error => sendResponse({ error: error.message }));

  return true; // Keep message channel open for async response
});

/**
 * Route messages to appropriate handlers.
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'AI_REQUEST':
      return handleAIRequest(message.action, message.data);

    case 'SAVE_RESUME':
      trackEvent('resume_saved');
      // A new resume invalidates every cached field mapping learned for the
      // previous one — old values would otherwise be reused without the AI.
      chrome.storage.local.remove('mappingCache').catch(() => {});
      return saveResumeData(message.data);

    case 'GET_RESUME':
      return getResumeData();

    case 'GET_RESUME_FILE':
      return getResumeFile();

    case 'SAVE_SETTINGS':
      return saveSettings(message.data);

    case 'GET_SETTINGS':
      return getSettings();

    case 'START_AUTOFILL':
      return startAutofill(message.tabId);

    case 'GET_STATUS':
      return getStatus();

    case 'INJECT_JOBMATE':
      return injectEngineIntoTab(sender && sender.tab);

    case 'TRACK_EVENT':
      trackEvent(message.event, message.data);
      return true;

    case 'GET_PROVIDERS':
      return getProviders();

    case 'REFRESH_ADMIN_SETTINGS':
      await refreshAdminSettings(true);
      return true;

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * Return the supported AI provider catalog (id, label, models, hints) so the
 * popup settings UI and the background always agree.
 */
function getProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    defaultModel: p.defaultModel,
    models: p.models,
    keyPlaceholder: p.keyPlaceholder
  }));
}

// ============================================================
// DYNAMIC ENGINE INJECTION
// ============================================================

const ENGINE_FILES = [
  'src/parser.js',
  'src/ai-service.js',
  'src/mapper.js',
  'src/filler.js',
  'src/navigator.js',
  'src/overlay.js',
  'src/content.js'
];

/**
 * Inject the full autofill engine into a tab (used by detector.js once a
 * job-application form is found, and as a retry path from startAutofill).
 */
async function injectEngineIntoTab(tab, retry = true) {
  if (!tab || !tab.id || !/^(https?|file):/.test(tab.url || '')) {
    throw new Error('Cannot inject into this page.');
  }

  try {
    // pdf.js worker + pdf/mammoth libs are loaded lazily only on pages that
    // need them (detector found a form). See web_accessible_resources.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ENGINE_FILES
    });
    // Notify the injected engine to run its own init.
    await chrome.tabs.sendMessage(tab.id, { type: 'JOBMATE_ENGINE_READY' }).catch(() => {});
    return true;
  } catch (error) {
    // Retry once after a beat (page may still be mid-load), then give up.
    if (retry) {
      await new Promise((r) => setTimeout(r, 800));
      return injectEngineIntoTab(tab, false);
    }
    throw error;
  }
}

// ============================================================
// AI REQUEST HANDLER
// ============================================================

/**
 * Handle AI requests from content scripts.
  * Makes actual AI API calls from the background worker.
  */
async function handleAIRequest(action, data) {
  const effective = await getEffectiveAIConfig();
  const provider = effective.aiProvider;

  if (!effective.apiKey) {
    throw new Error(
      `${PROVIDERS[provider]?.label || provider} API key not configured. Please set it in the extension popup.`
    );
  }

  switch (action) {
    case 'STRUCTURE_RESUME':
      return structureResumeWithAI({ aiProvider: provider }, data.rawText);

    case 'MAP_FIELD':
      return mapFieldWithAI({ aiProvider: provider }, data.fieldLabel, data.fieldType, data.options, data.resumeData);

    case 'ANSWER_QUESTION':
      return answerQuestionWithAI({ aiProvider: provider }, data.question, data.options, data.resumeData);

    default:
      throw new Error(`Unknown AI action: ${action}`);
  }
}

// ============================================================
// AI PROVIDERS (multi-provider support)
// ============================================================

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyPlaceholder: 'sk-...'
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.5-pro'],
    keyPlaceholder: 'AIza...'
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyPlaceholder: 'sk-...'
  },
  claude: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-haiku-latest',
    models: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514'],
    keyPlaceholder: 'sk-ant-...'
  }
};

function getProviderConfig(settings) {
  const provider = settings.aiProvider || 'openai';
  return PROVIDERS[provider] || PROVIDERS.openai;
}

/**
 * Route a chat request to the configured provider and return the raw text
 * response. All providers return plain text (JSON when jsonMode is set).
 * Every call is bounded by a timeout so a slow provider can never hang the
 * popup or the autofill pipeline.
 */
async function callLLM(settings, messages, jsonMode = false) {
  // Resolve the effective key/provider: the user's own settings win, then
  // the admin-provided shared config, then the defaults.
  const effective = await getEffectiveAIConfig();
  const provider = settings.aiProvider || effective.aiProvider;
  const apiKey = settings.apiKey || effective.apiKey;
  const config = getProviderConfig({ aiProvider: provider });
  const model = settings.aiModel || effective.aiModel || config.defaultModel;

  let promise;
  switch (provider) {
    case 'gemini':
      promise = callGemini(apiKey, model, messages, jsonMode);
      break;
    case 'deepseek':
      promise = callDeepSeek(apiKey, model, messages, jsonMode);
      break;
    case 'claude':
      promise = callClaude(apiKey, model, messages, jsonMode);
      break;
    case 'openai':
    default:
      promise = callOpenAI(apiKey, model, messages, jsonMode);
  }
  return withTimeout(promise);
}

const AI_TIMEOUT_MS = 90000;

function withTimeout(promise, ms = AI_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AI request timed out after ${Math.round(ms / 1000)}s. Try again or pick a faster model in Settings.`)),
      ms
    );
  });
  try {
    return Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(apiKey, model, messages, jsonMode = false) {
  const body = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 2400
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error (${response.status}): ${err.error?.message || 'Unknown error'}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

/**
 * Google Gemini (Generative Language API). System message is sent as
 * systemInstruction; JSON mode via responseMimeType.
 */
async function callGemini(apiKey, model, messages, jsonMode = false) {
  const systemInstruction = messages.filter((m) => m.role === 'system')
    .map((m) => m.content).join('\n\n');
  const userParts = messages.filter((m) => m.role !== 'system')
    .map((m) => m.content).join('\n\n');

  const generationConfig = { temperature: 0.1 };
  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: userParts }] }],
        generationConfig
      })
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API error (${response.status}): ${err?.error?.message || 'Unknown error'}`
    );
  }

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * DeepSeek (OpenAI-compatible chat completions API).
 */
async function callDeepSeek(apiKey, model, messages, jsonMode = false) {
  const body = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 2400
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`DeepSeek API error (${response.status}): ${err.error?.message || 'Unknown error'}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

/**
 * Anthropic Claude (Messages API). No strict JSON mode; the system prompt
 * instructs JSON-only output when jsonMode is on.
 */
async function callClaude(apiKey, model, messages, jsonMode = false) {
  const system = messages.filter((m) => m.role === 'system')
    .map((m) => m.content).join('\n\n');
  const userContent = messages.filter((m) => m.role !== 'system')
    .map((m) => m.content).join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      temperature: 0.1,
      system: (jsonMode
        ? 'Always respond with ONLY valid JSON. No markdown, no code fences, no explanations outside the JSON.\n\n'
        : '') + system,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Claude API error (${response.status}): ${err?.error?.message || 'Unknown error'}`
    );
  }

  const result = await response.json();
  return result.content?.[0]?.text || '';
}

/**
 * Structure raw resume text into JSON using AI.
 */
async function structureResumeWithAI(settings, rawText) {
  const systemPrompt = 'You are a precise resume parser. Always return valid JSON matching the exact schema requested.';

  const userPrompt = `Extract structured data from this resume and return as JSON.

Return EXACTLY this structure (use empty strings for missing fields, empty arrays for missing lists):
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "location": {
    "address": "",
    "city": "",
    "state": "",
    "country": "",
    "zip": ""
  },
  "linkedin": "",
  "github": "",
  "portfolio": "",
  "summary": "",
  "workExperience": [
    {
      "title": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": ""
    }
  ],
  "education": [
    {
      "degree": "",
      "school": "",
      "field": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "gpa": ""
    }
  ],
  "skills": [],
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "date": ""
    }
  ],
  "languages": [],
  "yearsOfExperience": "",
  "willingToRelocate": null,
  "authorizedToWork": null,
  "requiresSponsorship": null
}

Rules:
- Dates in MM/YYYY format
- Phone with country code if available
- Infer country from context
- Current job: endDate = "Present", current = true
- Calculate yearsOfExperience from work history if not stated
- Keep descriptions concise but complete

Resume:
${trimResumeText(rawText)}`;

  const result = await callLLM(settings, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], true);

  return JSON.parse(result);
}

/**
 * Resumes longer than this would only slow the AI parse down without adding
 * useful information — the first 30k chars cover contact info, experience
 * and education for virtually every real resume.
 */
const MAX_RESUME_CHARS = 30000;

function trimResumeText(rawText) {
  const text = String(rawText || '');
  if (text.length <= MAX_RESUME_CHARS) return text;
  return text.slice(0, MAX_RESUME_CHARS) + '\n\n[...resume text truncated; the rest was omitted for parsing speed...]';
}

/**
 * Map a form field to resume data using AI.
 */
async function mapFieldWithAI(settings, fieldLabel, fieldType, options, resumeData) {
  const prompt = `Map this form field to the best value from the resume data.

Field:
- Label: "${fieldLabel}"
- Type: ${fieldType}
${options?.length > 0 ? `- Options: ${JSON.stringify(options)}` : ''}

Resume Data:
${JSON.stringify(resumeData, null, 2)}

Return JSON:
{
  "value": "the value to fill",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation"
}

Rules:
- For dropdowns with options: value MUST be one of the options
- Empty string if cannot determine
- high = direct match, medium = semantic match, low = guess`;

  const result = await callLLM(settings, [
    { role: 'system', content: 'You are a form-filling assistant. Return valid JSON.' },
    { role: 'user', content: prompt }
  ], true);

  return JSON.parse(result);
}

/**
 * Answer a screening question using AI.
 */
async function answerQuestionWithAI(settings, question, options, resumeData) {
  const prompt = `Answer this job application question based on the candidate's resume.

Question: "${question}"
${options?.length > 0 ? `Options: ${JSON.stringify(options)}` : 'Free-text answer.'}

Resume:
${JSON.stringify(resumeData, null, 2)}

Return JSON:
{
  "answer": "your answer",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation"
}

Rules:
- If options provided: answer MUST be one of them
- EEO questions (gender, race, veteran, disability): answer "Decline to self-identify" if available, confidence "low"
- Don't fabricate info not in resume
- Conservative, truthful answers`;

  const result = await callLLM(settings, [
    { role: 'system', content: 'You are a careful job application assistant. Return valid JSON.' },
    { role: 'user', content: prompt }
  ], true);

  return JSON.parse(result);
}

// ============================================================
// STORAGE HELPERS
// ============================================================

async function saveResumeData(payload) {
  // Accept both the legacy shape (structured data directly) and the new shape
  // { data: <structured>, file: { name, type, base64 } } so the resume FILE can
  // be re-attached to Resume/CV upload fields on the page.
  if (payload && typeof payload === 'object' && payload.data) {
    await chrome.storage.local.set({
      resumeData: payload.data,
      resumeFile: payload.file || null
    });
  } else {
    await chrome.storage.local.set({ resumeData: payload });
  }
  return true;
}

async function getResumeData() {
  const result = await chrome.storage.local.get('resumeData');
  return result.resumeData || null;
}

async function getResumeFile() {
  const result = await chrome.storage.local.get('resumeFile');
  return result.resumeFile || null;
}

async function saveSettings(settings) {
  const existing = await getSettings();
  const updated = { ...existing, ...settings };
  await chrome.storage.local.set({ settings: updated });

  // If analytics got enabled, flush whatever was queued before the switch.
  if (updated.analyticsEnabled) {
    flushAnalytics().catch(() => {});
  }
  return true;
}

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || {};
}

// ============================================================
// ADMIN-SHARED AI KEY
// ============================================================
//
// The extension ships with a shared (admin-provided) API key so every user
// gets autofill working out of the box. The admin can change the key later
// from the admin panel — the extension re-fetches it from the admin server
// (the analytics endpoint's origin) and stores it locally. Individual users
// can always override the shared key with their own in the popup Settings.

const DEFAULT_ADMIN_CONFIG = {
  apiKey: 'AQ.Ab8RN6LEtc1kI6Ex9D46yZkkPJe5tjBVk_zSN2kQFgkLkntD4g',
  aiProvider: 'gemini',
  aiModel: ''
};

/**
 * Get the admin config, seeding the shipped shared key on first run so the
 * extension works before the admin server is even deployed.
 */
async function getAdminConfig() {
  const store = await chrome.storage.local.get(['adminConfig', 'adminConfigSeeded']);
  if (!store.adminConfigSeeded) {
    const seeded = { ...DEFAULT_ADMIN_CONFIG, updatedAt: Date.now() };
    await chrome.storage.local.set({ adminConfig: seeded, adminConfigSeeded: true });
    return seeded;
  }
  return store.adminConfig || null;
}

/**
 * Effective AI config: the user's own popup Settings always win; otherwise
 * the admin-provided shared key/provider is used.
 */
async function getEffectiveAIConfig() {
  const [settings, adminConfig] = await Promise.all([getSettings(), getAdminConfig()]);
  const provider = settings.aiProvider || (adminConfig && adminConfig.aiProvider) || 'openai';
  const config = getProviderConfig({ aiProvider: provider });
  return {
    apiKey: settings.apiKey || (adminConfig && adminConfig.apiKey) || '',
    aiProvider: provider,
    aiModel: settings.aiModel || (adminConfig && adminConfig.aiModel) || config.defaultModel,
    keySource: settings.apiKey ? 'user' : (adminConfig && adminConfig.apiKey ? 'admin' : 'none')
  };
}

let lastAdminRefresh = 0;

/**
 * Re-fetch the admin settings from the admin server (same origin as the
 * analytics endpoint, e.g. https://api.jobmate-ai.com/api/admin/settings).
 * Rate-limited to once per 10 minutes; failures keep the last known config.
 */
async function refreshAdminSettings(force = false) {
  try {
    const now = Date.now();
    if (!force && now - lastAdminRefresh < 10 * 60 * 1000) return;
    lastAdminRefresh = now;

    const settings = await getSettings();
    if (!settings.analyticsEndpoint) return;
    const origin = /^https?:\/\/[^/]+/.exec(settings.analyticsEndpoint);
    if (!origin) return;
    const response = await fetch(origin[0] + '/api/admin/settings', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) return;
    const cfg = await response.json();
    if (!cfg || typeof cfg !== 'object') return;
    if (!('apiKey' in cfg) && !('aiProvider' in cfg) && !('aiModel' in cfg)) return;

    await chrome.storage.local.set({
      adminConfig: {
        apiKey: cfg.apiKey !== undefined ? String(cfg.apiKey) : '',
        aiProvider: cfg.aiProvider || 'gemini',
        aiModel: cfg.aiModel || '',
        updatedAt: Date.now()
      },
      adminConfigSeeded: true
    });
    console.log('[JobMateAI] Admin settings refreshed from', base);
  } catch (e) {
    /* offline or not deployed yet — keep the last known shared key */
  }
}

// ============================================================
// ANALYTICS (OPT-IN, ANONYMOUS)
// ============================================================
//
// Events are anonymous: a random UUID (stored locally) + event name + site
// host + a few counters. Nothing personal is ever sent. The endpoint is
// user-configurable; calls are fire-and-forget, batched, and fail silently.

let pendingEvents = [];
let analyticsTimer = null;

/**
 * Queue an analytics event. No-op unless the user enabled analytics.
 * @param {string} event - event name (e.g. 'autofill_started')
 * @param {object} [data] - optional numeric/short-string payload
 */
async function trackEvent(event, data = {}) {
  try {
    const settings = await getSettings();
    if (!settings.analyticsEnabled || !settings.analyticsEndpoint) return;

    const userId = await getOrCreateUserId();
    pendingEvents.push({
      id: uuid(),
      ts: Date.now(),
      userId,
      event,
      site: safeHost(),
      ...sanitize(data)
    });

    if (!analyticsTimer) {
      analyticsTimer = setTimeout(() => {
        analyticsTimer = null;
        flushAnalytics().catch(() => {});
      }, 4000);
    }
  } catch (e) {
    /* analytics must never break the extension */
  }
}

function sanitize(data) {
  const allowed = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === 'number' || typeof value === 'string') {
      allowed[key] = String(value).slice(0, 120);
    }
  }
  return allowed;
}

function safeHost() {
  return ''; // callers pass site explicitly; see trackEvent data
}

function uuid() {
  try {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function getOrCreateUserId() {
  const stored = await chrome.storage.local.get('userId');
  if (stored.userId) return stored.userId;
  const userId = uuid();
  await chrome.storage.local.set({ userId });
  return userId;
}

/**
 * Flush queued events to the analytics endpoint. Batching keeps the request
 * volume low; failures are dropped silently and the queue is cleared.
 */
async function flushAnalytics() {
  const settings = await getSettings();
  if (!settings.analyticsEnabled || !settings.analyticsEndpoint) {
    pendingEvents = [];
    return;
  }
  if (pendingEvents.length === 0) return;

  const events = pendingEvents;
  pendingEvents = [];

  try {
    await fetch(settings.analyticsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, extension: 'jobmate-ai', version: '1.0.0' })
    });
  } catch (e) {
    // Drop silently; never retry spam the admin endpoint from background.
  }
}

// ============================================================
// AUTOFILL CONTROL
// ============================================================

async function startAutofill(tabId) {
  if (!tabId) {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
  }
  if (!tabId) {
    throw new Error('No active tab found.');
  }

  const tab = await chrome.tabs.get(tabId);

  // Send message to content script to start autofill, and surface real errors.
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'START_AUTOFILL' });
    if (response && response.error) throw new Error(response.error);
    trackEvent('autofill_started', { site: hostOf(tab && tab.url) });
    return true;
  } catch (error) {
    // No engine on this page yet: try dynamic injection once, then retry.
    try {
      await injectEngineIntoTab(tab);
      const response = await chrome.tabs.sendMessage(tabId, { type: 'START_AUTOFILL' });
      if (response && response.error) throw new Error(response.error);
      trackEvent('autofill_started', { site: hostOf(tab && tab.url) });
      return true;
    } catch (retryError) {
      throw new Error(
        'No job application form detected on this page. ' +
        'Open a job application form (e.g. Workday, Greenhouse, Lever, ...) and try again.'
      );
    }
  }
}

function hostOf(url) {
  try {
    return new URL(url || '').hostname || '';
  } catch (e) {
    return '';
  }
}

async function getStatus() {
  const resumeData = await getResumeData();
  const settings = await getSettings();
  const effective = await getEffectiveAIConfig();
  return {
    hasResume: !!resumeData,
    hasApiKey: !!settings.apiKey,
    aiProvider: settings.aiProvider || 'openai',
    aiModel: settings.aiModel || getProviderConfig(settings).defaultModel,
    keySource: effective.keySource,
    adminProvider: effective.aiProvider,
    analyticsEnabled: !!settings.analyticsEnabled,
    userId: (await chrome.storage.local.get('userId')).userId || null,
    resumeName: resumeData?.firstName ? `${resumeData.firstName} ${resumeData.lastName}` : null
  };
}

// ============================================================
// EXTENSION INSTALL/UPDATE
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[JobMateAI] Extension installed/updated:', details.reason);

  // Install/update events are sent only if the user later opts in: they are
  // queued and flushed when analytics is enabled.
  if (details.reason === 'install') {
    chrome.storage.local.set({ installDate: Date.now() });
  }

  // Seed the shared admin key on first install and refresh it from the admin
  // server whenever the extension updates (in case the key was rotated).
  getAdminConfig().then(() => refreshAdminSettings(true)).catch(() => {});
});
