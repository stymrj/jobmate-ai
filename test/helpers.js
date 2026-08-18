/**
 * test/helpers.js - Shared test harness for the JobMate AI extension.
 *
 * Builds simulated Workday pages in jsdom, loads the real content scripts,
 * mocks chrome APIs, and exposes helpers to drive and inspect autofill.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// Mock resume data (as produced by the OpenAI STRUCTURE_RESUME prompt)
// ---------------------------------------------------------------------------
const resumeData = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@example.com',
  phone: '+1 555-123-4567',
  location: { address: '123 Main St', city: 'Austin', state: 'TX', country: 'United States', zip: '78701' },
  linkedin: 'https://linkedin.com/in/janesmith',
  github: 'https://github.com/janesmith',
  portfolio: 'https://janesmith.dev',
  summary: 'Senior Software Engineer with 8 years of experience.',
  workExperience: [
    { title: 'Senior Software Engineer', company: 'Acme Corp', location: 'Austin TX', startDate: '01/2019', endDate: 'Present', current: true, description: 'Built scalable services.' },
    { title: 'Software Engineer', company: 'Beta Inc', location: 'Dallas TX', startDate: '06/2015', endDate: '12/2018', current: false, description: 'Developed APIs.' }
  ],
  education: [
    { degree: 'B.S. Computer Science', school: 'UT Austin', field: 'Computer Science', location: 'Austin TX', startDate: '08/2010', endDate: '05/2014', gpa: '3.8' }
  ],
  skills: ['JavaScript', 'React', 'Node.js', 'TypeScript'],
  certifications: [],
  languages: ['English', 'Spanish'],
  yearsOfExperience: '8',
  willingToRelocate: true,
  authorizedToWork: true,
  requiresSponsorship: false
};

// ---------------------------------------------------------------------------
// Page builders (simulate the Workday DOM structure)
// ---------------------------------------------------------------------------

function buildIntroduceYourselfPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Introduce Yourself | Workday</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Introduce Yourself</div>
      <div><span data-automation-id="label">First Name</span><input type="text" data-automation-id="promptInput" aria-label="First Name" /></div>
      <div><span data-automation-id="label">Last Name</span><input type="text" data-automation-id="promptInput" aria-label="Last Name" /></div>
      <div><span data-automation-id="label">Email</span><input type="email" data-automation-id="promptInput" aria-label="Email" /></div>
      <div><span data-automation-id="label">Phone Number</span><input type="tel" data-automation-id="promptInput" aria-label="Phone Number" /></div>
      <div><span data-automation-id="label">Country</span><select data-automation-id="countrySelect">
        <option value="" selected>Select...</option><option value="US">United States</option><option value="CA">Canada</option>
      </select></div>
      <div><span data-automation-id="label">City</span><input type="text" data-automation-id="promptInput" aria-label="City" /></div>
      <div><span data-automation-id="label">State/Province</span><input type="text" data-automation-id="promptInput" aria-label="State/Province" /></div>
      <div><span data-automation-id="label">Postal Code</span><input type="text" data-automation-id="promptInput" aria-label="Postal Code" /></div>
      <div><span data-automation-id="label">Resume/CV</span><div data-automation-id="resumeFileUpload"><input type="file" data-automation-id="resumeFile" accept=".pdf,.docx" /></div></div>
      <div><span data-automation-id="label">I agree to the terms</span><input type="checkbox" aria-label="I agree to the terms" /></div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Submit</button>
  </body></html>`;
}

function buildJobSearchPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Careers at Workday</title></head>
  <body>
    <header><a data-automation-id="jobApplyButton" href="#">Apply</a></header>
    <main>
      <input type="text" placeholder="Search jobs" data-automation-id="searchInput" />
      <div class="job-card"><h2>Senior Engineer</h2><a data-automation-id="jobPostingTitle" href="/en-US/Workday/job/xyz">Senior Engineer</a></div>
    </main>
  </body></html>`;
}

function buildWorkExperiencePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Work Experience</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Work Experience</div>
      <div data-automation-id="workExperienceSection">
        <div class="entry">
          <div><span data-automation-id="label">Job Title</span><input type="text" aria-label="Job Title" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">Company</span><input type="text" aria-label="Company" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">Start Date</span><input type="text" aria-label="Start Date" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">End Date</span><input type="text" aria-label="End Date" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">Job Description</span><textarea aria-label="Job Description"></textarea></div>
        </div>
        <button data-automation-id="addItemButton" type="button">Add Work Experience</button>
      </div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
    <script>
      document.querySelector('[data-automation-id="addItemButton"]').addEventListener('click', function () {
        var section = this.closest('[data-automation-id="workExperienceSection"]');
        var entry = section.querySelector('.entry').cloneNode(true);
        entry.querySelectorAll('input, textarea').forEach(function (i) { i.value = ''; });
        section.insertBefore(entry, this);
      });
    </script>
  </body></html>`;
}

function buildEducationPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Education</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Education</div>
      <div data-automation-id="educationSection">
        <div class="entry">
          <div><span data-automation-id="label">Degree</span><input type="text" aria-label="Degree" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">School</span><input type="text" aria-label="School" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">Start Date</span><input type="text" aria-label="Start Date" data-automation-id="promptInput" /></div>
          <div><span data-automation-id="label">End Date</span><input type="text" aria-label="End Date" data-automation-id="promptInput" /></div>
        </div>
        <button data-automation-id="addItemButton" type="button">Add Education</button>
      </div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
    <script>
      document.querySelector('[data-automation-id="addItemButton"]').addEventListener('click', function () {
        var section = this.closest('[data-automation-id="educationSection"]');
        var entry = section.querySelector('.entry').cloneNode(true);
        entry.querySelectorAll('input, textarea').forEach(function (i) { i.value = ''; });
        section.insertBefore(entry, this);
      });
    </script>
  </body></html>`;
}

function buildQuestionsPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Application Questions</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Application Questions</div>
      <div>
        <span data-automation-id="label">Are you legally authorized to work in the United States?</span>
        <div role="radiogroup">
          <label><input type="radio" name="auth" value="Yes" role="radio" /> Yes</label>
          <label><input type="radio" name="auth" value="No" role="radio" /> No</label>
        </div>
      </div>
      <div>
        <span data-automation-id="label">Will you now or in the future require sponsorship for employment visa status?</span>
        <div role="radiogroup">
          <label><input type="radio" name="sponsor" value="Yes" role="radio" /> Yes</label>
          <label><input type="radio" name="sponsor" value="No" role="radio" /> No</label>
        </div>
      </div>
      <div>
        <span data-automation-id="label">Gender</span>
        <div role="radiogroup">
          <label><input type="radio" name="gender" value="Female" role="radio" /> Female</label>
          <label><input type="radio" name="gender" value="Male" role="radio" /> Male</label>
          <label><input type="radio" name="gender" value="Decline to self-identify" role="radio" /> Decline to self-identify</label>
        </div>
      </div>
      <div>
        <span data-automation-id="label">Are you willing to relocate to Santa Clara, CA?</span>
        <div role="radiogroup">
          <label><input type="radio" name="relocate" value="Yes" role="radio" /> Yes</label>
          <label><input type="radio" name="relocate" value="No" role="radio" /> No</label>
        </div>
      </div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
  </body></html>`;
}

function buildLoginPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sign In</title></head>
  <body>
    <main>
      <h2>Sign In</h2>
      <input type="email" data-automation-id="promptInput" aria-label="Email" />
      <input type="password" data-automation-id="promptInput" aria-label="Password" />
      <button type="submit">Sign In</button>
    </main>
  </body></html>`;
}

function buildStartApplicationScreen() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Start Your Application</title></head>
  <body>
    <main>
      <h2>Start Your Application</h2>
      <button type="button">Autofill with Resume</button>
      <button type="button" id="applyManually">Apply Manually</button>
      <button type="button">Use My Last Application</button>
    </main>
    <script>
      document.getElementById('applyManually').addEventListener('click', function () {
        window.__applyManuallyClicked = true;
      });
    </script>
  </body></html>`;
}

function buildDateWidgetPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Work Date</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Experience</div>
      <div>
        <span data-automation-id="label">Start Date</span>
        <div data-automation-id="dateSection" class="dateSection">
          <select data-automation-id="dateSectionMonth">
            <option value=""></option>
            <option value="1">January</option><option value="2">February</option><option value="3">March</option>
            <option value="4">April</option><option value="5">May</option><option value="6">June</option>
            <option value="7">July</option><option value="8">August</option><option value="9">September</option>
            <option value="10">October</option><option value="11">November</option><option value="12">December</option>
          </select>
          <select data-automation-id="dateSectionDay">
            <option value=""></option>
            <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
            <option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option>
            <option value="9">9</option><option value="10">10</option><option value="11">11</option><option value="12">12</option>
          </select>
          <input type="text" data-automation-id="dateSectionYear" />
        </div>
      </div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
  </body></html>`;
}

function buildValidationPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Additional Info</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Additional Information</div>
      <div><span data-automation-id="label">First Name</span><input type="text" aria-label="First Name" data-automation-id="promptInput" /></div>
      <div><span data-automation-id="label">Driver&apos;s License Number</span><input type="text" aria-label="Driver's License Number" data-automation-id="promptInput" required /></div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Set up a jsdom window with mocked chrome APIs and content scripts loaded
// ---------------------------------------------------------------------------
async function setup(options = {}) {
  const url = options.url || 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/introduceYourself';
  const pageHtml = options.pageHtml || buildIntroduceYourselfPage();

  const files = [
    'parser.js',
    'ai-service.js',
    'mapper.js',
    'filler.js',
    'navigator.js',
    'overlay.js',
    'content.js'
  ];
  const combined = files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
  const html = pageHtml.replace('</body>', `<script>${combined}</script>\n</body>`);

  let resumeDataMock = options.resumeData !== undefined ? options.resumeData : null;
  let resumeFileMock = options.resumeFile !== undefined ? options.resumeFile : null;
  // aiMock(action, fieldLabel, fieldType, options, resumeData)
  let aiMock = options.aiMock || ((action) => {
    if (action === 'ANSWER_QUESTION') return { answer: '', confidence: 'low', reasoning: 'mock' };
    return { value: '', confidence: 'low', reasoning: 'mock' };
  });
  const messageListeners = [];
  // Per-setup in-memory storage; pass `storage: sharedMap` to make state (e.g.
  // the mapping cache) survive across setups for caching tests.
  const localStorage = options.storage || new Map();

  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
        get() { return this.parentElement || window.document.documentElement; }
      });
      Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() {
          // innerText only exposes *rendered* text; scripts/styles and hidden
          // elements are excluded (important for step detection which reads
          // page copy to look for "review"/"sign in" etc.).
          const clone = this.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
          clone.querySelectorAll('*').forEach((el) => {
            const st = el.style;
            if (st && (st.display === 'none' || st.visibility === 'hidden')) el.remove();
          });
          return (clone.textContent || '').replace(/\s+/g, ' ');
        }
      });
      if (!window.DataTransfer) {
        window.DataTransfer = class DataTransfer {
          constructor() { this._file = null; }
          get items() { return { add: (file) => { this._file = file; } }; }
          get files() {
            const file = this._file;
            return { length: file ? 1 : 0, 0: file, item: (i) => (i === 0 ? file : null) };
          }
        };
      }
      const filesDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
      if (filesDesc && filesDesc.set) {
        Object.defineProperty(window.HTMLInputElement.prototype, 'files', {
          configurable: true,
          get() { return this._wafTestFiles || filesDesc.get.call(this); },
          set(value) {
            if (value && typeof value.length === 'number' && value[0] instanceof window.File) {
              this._wafTestFiles = value;
            } else {
              filesDesc.set.call(this, value);
            }
          }
        });
      }
      window.chrome = {
        runtime: {
          id: 'test-extension-id',
          getURL: (p) => 'chrome-extension://test-extension-id/' + p,
          onMessage: { addListener: (fn) => messageListeners.push(fn) },
          sendMessage: async (msg, cb) => {
            const handlers = {
              GET_RESUME: () => ({ result: resumeDataMock }),
              GET_RESUME_FILE: () => ({ result: resumeFileMock }),
              GET_STATUS: () => ({
                result: {
                  hasResume: !!resumeDataMock,
                  hasApiKey: true,
                  resumeName: resumeDataMock && (resumeDataMock.firstName || resumeDataMock.lastName)
                    ? `${resumeDataMock.firstName || ''} ${resumeDataMock.lastName || ''}`.trim()
                    : null
                }
              }),
              AI_REQUEST: () => {
                try {
                  return { result: aiMock(msg.action, msg.data) };
                } catch (error) {
                  return { error: error.message };
                }
              }
            };
            if (handlers[msg.type]) {
              const response = handlers[msg.type]();
              if (cb) setTimeout(() => cb(response), 0);
              return Promise.resolve(response);
            }
            if (cb) setTimeout(() => cb({ result: null }), 0);
            return Promise.resolve({ result: null });
          },
          tabs: { query: async () => [{ id: 1 }] }
        },
        storage: {
          local: {
            get: async (key) => {
              if (Array.isArray(key)) {
                const out = {};
                for (const k of key) out[k] = localStorage.get(k);
                return out;
              }
              return { [key]: localStorage.get(key) };
            },
            set: async (obj) => {
              for (const [k, v] of Object.entries(obj)) localStorage.set(k, v);
            },
            remove: async (keys) => {
              for (const k of Array.isArray(keys) ? keys : [keys]) localStorage.delete(k);
            }
          }
        }
      };
    }
  });

  const { window } = dom;
  const overlayPanel = () => window.document.getElementById('jobmate-ai-overlay');
  const getGlobal = (name) => window.eval(name);
  const shadowRoot = () => {
    try { return window.eval('OverlayUI').shadowRoot; } catch (e) { return null; }
  };
  const statusText = () => {
    const sr = shadowRoot();
    return sr ? (sr.querySelector('.jm-status-text') || {}).textContent : null;
  };
  const resultsHTML = () => {
    const sr = shadowRoot();
    return sr ? (sr.querySelector('.jm-results') || {}).innerHTML : null;
  };
  const actionsHTML = () => {
    const sr = shadowRoot();
    return sr ? (sr.querySelector('.jm-actions') || {}).innerHTML : null;
  };
  const valueOf = (selector) => {
    const el = window.document.querySelector(selector);
    return el ? el.value : null;
  };
  const valueOfIndex = (selector, index) => {
    const el = window.document.querySelectorAll(selector)[index];
    return el ? el.value : null;
  };
  const checkedOf = (selector, index = 0) => {
    const el = window.document.querySelectorAll(selector)[index];
    return el ? el.checked : null;
  };
  const count = (selector) => window.document.querySelectorAll(selector).length;

  const triggerAutofill = () => {
    for (const fn of messageListeners) {
      fn({ type: 'START_AUTOFILL' }, {}, () => {});
    }
  };

  return {
    dom, window, messageListeners, getGlobal,
    overlayPanel, statusText, resultsHTML, actionsHTML, valueOf, valueOfIndex, checkedOf, count,
    triggerAutofill,
    storage: localStorage,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  };
}

async function waitFor(fn, timeout = 8000, interval = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Timed out waiting for condition');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

module.exports = {
  SRC, resumeData,
  buildIntroduceYourselfPage, buildJobSearchPage, buildWorkExperiencePage,
  buildEducationPage, buildQuestionsPage, buildLoginPage, buildStartApplicationScreen,
  buildDateWidgetPage, buildValidationPage,
  setup, waitFor, assert
};