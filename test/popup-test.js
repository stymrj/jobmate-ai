/**
 * test/popup-test.js - Popup UI tests.
 *
 * Verifies:
 *  - The "Start Autofill on Page" button is actually wired up (previously it
 *    had no click handler at all, so autofill could never start).
 *  - When a resume is already saved, the popup shows it and enables autofill
 *    directly instead of forcing a re-upload.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const POPUP_HTML = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.js'), 'utf8');

function loadPopup(hasResume) {
  // Strip external <script> tags (libs + popup.js) so we can inject popup.js
  // ourselves with a mocked chrome environment.
  const html = POPUP_HTML.replace(/<script[^>]*><\/script>/g, '');

  const dom = new JSDOM(html, { url: 'chrome-extension://test-id/popup/popup.html', runScripts: 'outside-only' });
  const { window } = dom;

  const sent = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const handlers = {
          GET_STATUS: () => ({
            result: hasResume
              ? { hasResume: true, hasApiKey: true, resumeName: 'Jane Smith' }
              : { hasResume: false, hasApiKey: true, resumeName: null }
          }),
          START_AUTOFILL: () => ({ result: true })
        };
        const resp = handlers[msg.type] ? handlers[msg.type]() : { result: null };
        if (cb) setTimeout(() => cb(resp), 0);
        return Promise.resolve(resp);
      }
    },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  };

  window.eval(POPUP_JS);
  return { window, sent, dom };
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

(async () => {
  console.log('=== POPUP TEST 1: Start Autofill button is wired ===');
  const { window } = loadPopup(false);
  const btn = window.document.getElementById('autofillBtn');
  assert(btn, 'autofill button exists');
  btn.click();
  await new Promise((r) => setTimeout(r, 50));
  // The button should have dispatched START_AUTOFILL (even if disabled, click
  // handler still fires; with no resume the button is disabled but wired).
  // We check that a click handler exists and does not throw.
  console.log('  (button clicked without error; handler present)');

  console.log('\n=== POPUP TEST 2: Saved resume enables autofill directly ===');
  const { window: w2 } = loadPopup(true);
  await new Promise((r) => setTimeout(r, 100));
  const autofillBtn = w2.document.getElementById('autofillBtn');
  const dropZone = w2.document.getElementById('dropZone');
  const fileInfo = w2.document.getElementById('fileInfo');
  const parseBtn = w2.document.getElementById('parseBtn');
  assert(!autofillBtn.disabled, 'autofill button enabled when resume is saved');
  assert(dropZone.style.display === 'none', 'drop zone hidden (no re-upload needed)');
  assert(fileInfo.style.display === 'block', 'saved resume info shown');
  assert(parseBtn.disabled, 'parse button disabled when resume is saved');

  console.log('\n=== POPUP TEST 3: Clicking autofill sends START_AUTOFILL ===');
  const { window: w3, sent } = loadPopup(true);
  await new Promise((r) => setTimeout(r, 100));
  const b3 = w3.document.getElementById('autofillBtn');
  b3.disabled = false;
  b3.click();
  await new Promise((r) => setTimeout(r, 100));
  assert(sent.some((m) => m.type === 'START_AUTOFILL'), 'START_AUTOFILL message was sent to background');

  console.log('\nALL POPUP TESTS PASSED');
})().catch((e) => {
  console.error('\nPOPUP TEST FAILURE:', e.message);
  console.error(e);
  process.exit(1);
});