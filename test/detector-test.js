/**
 * test/detector-test.js - Detector script tests.
 *
 * Verifies the lightweight <all_urls> detector:
 *  - Asks the background to inject the engine when a job-application form is
 *    found (generic page, no Workday automation ids).
 *  - Stays silent on non-job pages and on job pages without a form.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const DETECTOR = fs.readFileSync(path.join(__dirname, '..', 'src', 'detector.js'), 'utf8');

function buildPage(body, title) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>${body}</body></html>`;
}

const JOB_FORM = buildPage(`
  <h1>Job Application</h1>
  <form>
    <label>First Name <input type="text" name="fn"></label>
    <label>Email <input type="email" name="em"></label>
    <label>Country <select name="c"><option>US</option></select></label>
    <button type="submit">Continue</button>
  </form>`, 'Careers - Apply');

const NO_FORM = buildPage(`
  <h1>Welcome</h1>
  <p>Contact us about our products.</p>`, 'Example Products');

const FORM_NO_JOB = buildPage(`
  <h1>Sign Up</h1>
  <form>
    <label>Name <input type="text" name="n"></label>
    <label>Email <input type="email" name="e"></label>
    <label>Password <input type="password" name="p"></label>
    <button type="submit">Create account</button>
  </form>`, 'Create your account');

async function setup(pageHtml, url) {
  const injected = [];
  const dom = new JSDOM(pageHtml, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      // jsdom's getBoundingClientRect returns zeros; give fields a size.
      window.HTMLElement.prototype.getBoundingClientRect = function () {
        const tag = this.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
          return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
        }
        return { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 };
      };
      window.chrome = {
        runtime: {
          id: 'test',
          getURL: (p) => 'chrome-extension://test/' + p,
          onMessage: { addListener: () => {} },
          sendMessage: (msg, cb) => {
            if (msg && msg.type === 'INJECT_JOBMATE') injected.push(msg);
            const resp = { result: true };
            if (cb) setTimeout(() => cb(resp), 0);
            return Promise.resolve(resp);
          }
        }
      };
    }
  });
  // Load the detector as a classic script (like a content script).
  const script = dom.window.document.createElement('script');
  script.textContent = DETECTOR;
  dom.window.document.head.appendChild(script);
  return { injected };
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== DETECTOR TEST 1: generic job application form detected ===');
  const t1 = await setup(JOB_FORM, 'https://boards.greenhouse.io/example/jobs/123');
  await sleep(1200);
  assert(t1.injected.length >= 1, 'INJECT_JOBMATE sent for a generic job form');

  console.log('\n=== DETECTOR TEST 2: non-job page stays silent ===');
  const t2 = await setup(NO_FORM, 'https://example.com/');
  await sleep(1200);
  assert(t2.injected.length === 0, 'no injection on an unrelated page');

  console.log('\n=== DETECTOR TEST 3: form without job context stays silent ===');
  const t3 = await setup(FORM_NO_JOB, 'https://example.com/signup');
  await sleep(1200);
  assert(t3.injected.length === 0, 'no injection on a signup form without job context');

  console.log('\nALL DETECTOR TESTS PASSED');
})().catch((e) => {
  console.error('\nDETECTOR TEST FAILURE:', e.message);
  console.error(e);
  process.exit(1);
});
