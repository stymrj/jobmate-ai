/**
 * test/features-test.js - Feature tests for the AI-driven automation:
 *   - screening / EEO / Yes-No questions (AI answer + heuristic fallback)
 *   - repeatable Work Experience and Education sections
 *   - Workday split date widgets
 *   - required-field validation after filling
 *   - login / start-application screens (never auto-fill auth)
 *   - heuristic-only mode when the AI call fails
 *   - review page never auto-submits
 *   - generic (non-Workday) job application forms
 *   - mapping cache: AI answers are saved and reused (no repeat AI calls),
 *     user corrections made before "Review & Continue" are captured,
 *     and confirmed question answers are cached
 */
const {
  resumeData,
  buildWorkExperiencePage,
  buildEducationPage,
  buildQuestionsPage,
  buildLoginPage,
  buildStartApplicationScreen,
  buildDateWidgetPage,
  buildValidationPage,
  setup,
  waitFor,
  assert
} = require('./helpers');

function buildGenericFormPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Apply - Senior Engineer | Example Careers</title></head>
  <body>
    <form id="application">
      <h1>Job Application</h1>
      <label>First Name <input type="text" name="first_name"></label>
      <label>Last Name <input type="text" name="last_name"></label>
      <label>Email <input type="email" name="email"></label>
      <label>Phone <input type="tel" name="phone"></label>
      <label>City <input type="text" name="city"></label>
      <label>Country
        <select name="country">
          <option value="">Select...</option>
          <option value="us">United States</option>
          <option value="ca">Canada</option>
        </select>
      </label>
      <label>Are you authorized to work in the US?
        <select name="authorized">
          <option value="">Select...</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      <label>Work Start Date <input type="date" name="start_date"></label>
      <label>LinkedIn <input type="text" name="linkedin"></label>
      <button type="submit">Continue</button>
    </form>
  </body></html>`;
}

async function testGenericFormPage() {
  console.log('\n=== FEATURE: Generic (non-Workday) job application form ===');
  const t = await setup({
    resumeData,
    pageHtml: buildGenericFormPage(),
    url: 'https://boards.greenhouse.io/example/jobs/123'
  });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0, 8000);
  assert(t.overlayPanel(), 'overlay shown on a generic application page');

  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.valueOf('input[name="first_name"]') === 'Jane', 'generic first name filled');
  assert(t.valueOf('input[name="last_name"]') === 'Smith', 'generic last name filled');
  assert(t.valueOf('input[name="email"]') === 'jane.smith@example.com', 'generic email filled');
  assert(t.valueOf('input[name="phone"]') === '+1 555-123-4567', 'generic phone filled');
  assert(t.valueOf('input[name="city"]') === 'Austin', 'generic city filled');
  assert(t.valueOf('select[name="country"]') === 'us', 'generic country dropdown filled');
  assert(t.valueOf('select[name="authorized"]') === 'yes', 'work-authorization question answered');
  assert(t.valueOf('input[name="start_date"]') === '2019-01-01', 'date field filled from resume (ISO for native date input)');
}

const AI_DOWN = () => { throw new Error('no API key'); };

async function testQuestionsHeuristicFallback() {
  console.log('\n=== FEATURE: Yes/No + EEO questions via heuristic (AI down) ===');
  const t = await setup({ resumeData, pageHtml: buildQuestionsPage(), aiMock: AI_DOWN });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.checkedOf('input[name="auth"]', 0) === true, 'authorized-to-work = Yes');
  assert(t.checkedOf('input[name="sponsor"]', 1) === true, 'requires-sponsorship = No (heuristic negation)');
  assert(t.checkedOf('input[name="relocate"]', 0) === true, 'willing-to-relocate = Yes');
  assert(t.checkedOf('input[name="gender"]', 0) === false, 'gender left unanswered (no fabricated data)');
}

async function testQuestionsWithAI() {
  console.log('\n=== FEATURE: EEO question answered by AI ===');
  const aiMock = (action, data) => {
    if (action !== 'ANSWER_QUESTION') return { value: '', confidence: 'low' };
    if (String(data.question || '').toLowerCase().includes('gender')) {
      return { answer: 'Decline to self-identify', confidence: 'high', reasoning: 'EEO question' };
    }
    return { answer: '', confidence: 'low' };
  };
  const t = await setup({ resumeData, pageHtml: buildQuestionsPage(), aiMock });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.checkedOf('input[name="gender"]', 2) === true, 'gender declined via AI answer');
}

async function testWorkExperienceRepeatable() {
  console.log('\n=== FEATURE: Repeatable Work Experience (2 resume jobs) ===');
  const t = await setup({ resumeData, pageHtml: buildWorkExperiencePage() });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 20000);

  assert(t.count('.entry') === 2, `added a repeatable row (got ${t.count('.entry')} entries)`);
  assert(t.valueOfIndex('input[aria-label="Job Title"]', 0) === 'Senior Software Engineer', 'job 1 title filled');
  assert(t.valueOfIndex('input[aria-label="Company"]', 0) === 'Acme Corp', 'job 1 company filled');
  assert(t.valueOfIndex('input[aria-label="Job Title"]', 1) === 'Software Engineer', 'job 2 title filled');
  assert(t.valueOfIndex('input[aria-label="Company"]', 1) === 'Beta Inc', 'job 2 company filled');
  assert(t.valueOfIndex('input[aria-label="Start Date"]', 1) === '06/2015', 'job 2 start date filled');
  assert(t.valueOfIndex('textarea[aria-label="Job Description"]', 1) === 'Developed APIs.', 'job 2 description filled');
}

async function testEducationPage() {
  console.log('\n=== FEATURE: Education step ===');
  const t = await setup({ resumeData, pageHtml: buildEducationPage() });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.valueOf('input[aria-label="Degree"]') === 'B.S. Computer Science', 'degree filled');
  assert(t.valueOf('input[aria-label="School"]') === 'UT Austin', 'school filled');
  assert(t.valueOf('input[aria-label="Start Date"]') === '08/2010', 'education start date filled');
  assert(t.valueOf('input[aria-label="End Date"]') === '05/2014', 'education end date filled');
}

async function testDateWidget() {
  console.log('\n=== FEATURE: Workday split Month/Day/Year date widget ===');
  const t = await setup({ resumeData, pageHtml: buildDateWidgetPage(), url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz' });
  const FormFiller = t.getGlobal('FormFiller');
  const monthSel = t.window.document.querySelector('[data-automation-id="dateSectionMonth"]');

  const ok = await FormFiller.fillDateField(monthSel, '08/10/2010');
  assert(ok, 'split date widget filled');
  assert(t.window.document.querySelector('[data-automation-id="dateSectionMonth"]').value === '8', 'month part = 8');
  assert(t.window.document.querySelector('[data-automation-id="dateSectionDay"]').value === '10', 'day part = 10');
  assert(t.window.document.querySelector('[data-automation-id="dateSectionYear"]').value === '2010', 'year part = 2010');

  const parsed = FormFiller.parseDate('Jan 2019');
  assert(parsed.month === '01' && parsed.year === '2019', 'parseDate handles "Jan 2019"');
  assert(FormFiller.normalizeYear('19') === '2019', '2-digit year normalization');
}

async function testValidationWarning() {
  console.log('\n=== FEATURE: Required-field validation after fill ===');
  const t = await setup({ resumeData, pageHtml: buildValidationPage(), url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz' });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.valueOf('input[aria-label="First Name"]') === 'Jane', 'mappable field still filled');
  assert(/1 required field\(s\) still empty/.test(t.statusText()), 'validation warns about the empty required field');
}

async function testLoginPageBlocked() {
  console.log('\n=== FEATURE: Login screen — no autofill, manual sign-in message ===');
  const t = await setup({ resumeData, pageHtml: buildLoginPage(), url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz' });
  await waitFor(() => t.statusText() && t.statusText().includes('Sign in manually'), 8000);

  t.triggerAutofill();
  await waitFor(() => t.statusText() && t.statusText().includes('does not fill credentials'));
  assert(!t.resultsHTML() || t.resultsHTML().trim() === '', 'no fields filled on the login screen');
}

async function testStartApplicationScreen() {
  console.log('\n=== FEATURE: "Start Your Application" screen chooses Apply Manually ===');
  const t = await setup({ resumeData, pageHtml: buildStartApplicationScreen(), url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz' });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.statusText() && /No fillable fields found/.test(t.statusText()), 15000);
  assert(t.window.__applyManuallyClicked === true, 'Apply Manually button was clicked');
}

async function testHeuristicOnlyMode() {
  console.log('\n=== FEATURE: Heuristic-only mode (AI calls fail) ===');
  const t = await setup({ resumeData, aiMock: AI_DOWN });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.valueOf('input[aria-label="First Name"]') === 'Jane', 'heuristic fill still works without AI');
  assert(t.valueOf('select[data-automation-id="countrySelect"]') === 'US', 'dropdown heuristic fill works');
}

async function testReviewPage() {
  console.log('\n=== FEATURE: Review page — manual submit only ===');
  const page = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Review Your Application</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Review</div>
      <p>Review your application before submitting.</p>
    </main>
    <button data-automation-id="submitButton" type="button">Submit Application</button>
  </body></html>`;
  const t = await setup({ resumeData, pageHtml: page, url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz' });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && /Review Page Detected/.test(t.resultsHTML()), 15000);
  assert(!/Submit Application|auto-submit/.test(t.statusText() || ''), 'does not auto-submit');
}

function buildNativeRadioPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Questions | Example Careers</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Questions</div>
      <div>
        <span>Are you legally authorized to work in the United States?</span>
        <label><input type="radio" name="auth" value="y"> Yes</label>
        <label><input type="radio" name="auth" value="n"> No</label>
      </div>
      <div>
        <span>Gender</span>
        <label><input type="radio" name="gender" value="f"> Female</label>
        <label><input type="radio" name="gender" value="m"> Male</label>
        <label><input type="radio" name="gender" value="d"> Decline to self-identify</label>
      </div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
  </body></html>`;
}

/**
 * Plain HTML radio groups (no role="radiogroup" — common on Greenhouse,
 * Lever and generic career sites) must be scanned and filled too.
 */
async function testNativeRadioGroups() {
  console.log('\n=== FEATURE: plain HTML radio groups are filled ===');
  const t = await setup({ resumeData, pageHtml: buildNativeRadioPage() });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.checkedOf('input[name="auth"]', 0) === true, 'authorized-to-work answered Yes (native radios)');
  assert(t.checkedOf('input[name="auth"]', 1) === false, 'No option left unchecked');
  assert(t.checkedOf('input[name="gender"]', 0) === false, 'gender not fabricated (no heuristic)');
}

/**
 * The Workday split date widget must be auto-filled by the pipeline as ONE
 * date field — its Month/Day/Year parts are skipped as separate fields.
 */
async function testDateWidgetThroughPipeline() {
  console.log('\n=== FEATURE: split date widget auto-filled by the pipeline ===');
  const t = await setup({
    resumeData,
    pageHtml: buildDateWidgetPage(),
    url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/apply/xyz'
  });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);

  assert(t.valueOf('[data-automation-id="dateSectionMonth"]') === '1', 'month part = 1 (from 01/2019)');
  assert(t.valueOf('[data-automation-id="dateSectionYear"]') === '2019', 'year part = 2019');
}

/**
 * When the application page changes (SPA step change, manual "Next" click),
 * the extension must detect the new page and process it automatically.
 */
async function testPageChangeAutoProcess() {
  console.log('\n=== FEATURE: page change triggers automatic re-processing ===');
  const firstStep = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Introduce Yourself</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Introduce Yourself</div>
      <div><span data-automation-id="label">First Name</span><input type="text" aria-label="First Name" data-automation-id="promptInput" /></div>
      <div><span data-automation-id="label">Email</span><input type="email" aria-label="Email" data-automation-id="promptInput" /></div>
    </main>
  </body></html>`;
  const secondStep = `<main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Education</div>
      <div><span data-automation-id="label">Degree</span><input type="text" aria-label="Degree" data-automation-id="promptInput" /></div>
      <div><span data-automation-id="label">School</span><input type="text" aria-label="School" data-automation-id="promptInput" /></div>
    </main>`;

  const t = await setup({ resumeData, pageHtml: firstStep, aiMock: AI_DOWN });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 15000);
  assert(t.valueOf('input[aria-label="First Name"]') === 'Jane', 'first step filled');

  // Simulate an SPA step change: the site replaces its form area in place.
  const formArea = t.window.document.querySelector('[data-automation-id="formArea"]');
  const replacement = t.window.document.createElement('div');
  replacement.innerHTML = secondStep;
  formArea.replaceWith(replacement.firstElementChild);

  await waitFor(() => t.valueOf('input[aria-label="School"]') === 'UT Austin', 15000);
  assert(t.valueOf('input[aria-label="Degree"]') === 'B.S. Computer Science', 'new step auto-processed after page change');
}

function buildCachePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Experience | Example Careers</title></head>
  <body>
    <main data-automation-id="formArea">
      <div data-automation-id="pageHeaderTitle">Experience</div>
      <div><span data-automation-id="label">First Name</span><input type="text" aria-label="First Name" data-automation-id="promptInput" /></div>
      <div><span data-automation-id="label">Referral Source</span><input type="text" aria-label="Referral Source" data-automation-id="promptInput" /></div>
    </main>
    <button data-automation-id="bottom-navigation-next-button" type="button">Continue</button>
  </body></html>`;
}

/**
 * The mapping cache is the main AI-cost saver: an unknown field is sent to the
 * AI once, its answer is stored, and every later application (or page) with
 * the same label reuses it — even if the AI is completely unavailable.
 * Corrections the user makes before "Review & Continue" are also learned.
 */
async function testMappingCacheSkipsAI() {
  console.log('\n=== FEATURE: mapping cache — no repeat AI calls, corrections learned ===');
  const sharedStorage = new Map();
  let aiCalls = 0;
  const pageHtml = buildCachePage();

  const aiMock = (action) => {
    if (action === 'MAP_FIELD') {
      aiCalls++;
      return { value: 'Referred by recruiter', confidence: 'high', reasoning: 'mock' };
    }
    return { value: '', confidence: 'low' };
  };

  // First application: Referral Source is unknown → one AI call.
  const t1 = await setup({ resumeData, pageHtml, storage: sharedStorage, aiMock });
  await waitFor(() => t1.overlayPanel() && t1.messageListeners.length > 0);
  t1.triggerAutofill();
  await waitFor(() => t1.resultsHTML() && t1.resultsHTML().length > 0, 15000);
  assert(t1.valueOf('input[aria-label="Referral Source"]') === 'Referred by recruiter', 'unknown field answered via AI on first run');
  assert(aiCalls === 1, `exactly one AI mapping call on first run (got ${aiCalls})`);

  // The user corrects the value, then clicks "Review & Continue".
  t1.window.document.querySelector('input[aria-label="Referral Source"]').value = 'Referred by Jane';
  t1.window.eval('saveFilledValues()');
  await t1.sleep(150); // let the fire-and-forget storage write land
  const cacheMap = sharedStorage.get('mappingCache') || {};
  assert(Object.keys(cacheMap).length >= 2, 'confirmed values were saved into the mapping cache');

  // Second application (same site, different page instance): AI is DOWN, but
  // the cached + corrected values are reused — zero new AI calls.
  const t2 = await setup({ resumeData, pageHtml, storage: sharedStorage, aiMock: AI_DOWN });
  await waitFor(() => t2.overlayPanel() && t2.messageListeners.length > 0);
  t2.triggerAutofill();
  await waitFor(() => t2.resultsHTML() && t2.resultsHTML().length > 0, 15000);
  assert(t2.valueOf('input[aria-label="Referral Source"]') === 'Referred by Jane', 'user correction reused from cache (AI down)');
  assert(t2.valueOf('input[aria-label="First Name"]') === 'Jane', 'heuristic fields still filled from resume');
  assert(aiCalls === 1, `no additional AI calls thanks to the cache (got ${aiCalls})`);
}

/**
 * Confirmed screening-question answers are cached too, so EEO / Yes-No
 * questions never need the AI twice.
 */
async function testQuestionAnswerCached() {
  console.log('\n=== FEATURE: confirmed question answers are cached ===');
  const sharedStorage = new Map();
  let aiCalls = 0;
  const aiMock = (action, data) => {
    if (action !== 'ANSWER_QUESTION') return { value: '', confidence: 'low' };
    if (String(data.question || '').toLowerCase().includes('gender')) {
      aiCalls++;
      return { answer: 'Decline to self-identify', confidence: 'high', reasoning: 'EEO question' };
    }
    return { answer: '', confidence: 'low' };
  };

  const t1 = await setup({ resumeData, pageHtml: buildQuestionsPage(), storage: sharedStorage, aiMock });
  await waitFor(() => t1.overlayPanel() && t1.messageListeners.length > 0);
  t1.triggerAutofill();
  await waitFor(() => t1.resultsHTML() && t1.resultsHTML().length > 0, 15000);
  assert(t1.checkedOf('input[name="gender"]', 2) === true, 'gender declined via AI on first run');
  assert(aiCalls === 1, `one AI question call on first run (got ${aiCalls})`);

  // Same questions page again, AI completely down: the cached "Decline to
  // self-identify" answer is reused without any AI call.
  const t2 = await setup({ resumeData, pageHtml: buildQuestionsPage(), storage: sharedStorage, aiMock: AI_DOWN });
  await waitFor(() => t2.overlayPanel() && t2.messageListeners.length > 0);
  t2.triggerAutofill();
  await waitFor(() => t2.resultsHTML() && t2.resultsHTML().length > 0, 15000);
  assert(t2.checkedOf('input[name="gender"]', 2) === true, 'gender answer reused from cache (AI down)');
  assert(aiCalls === 1, `no additional question AI calls thanks to the cache (got ${aiCalls})`);
}

(async () => {
  await testQuestionsHeuristicFallback();
  await testQuestionsWithAI();
  await testWorkExperienceRepeatable();
  await testEducationPage();
  await testDateWidget();
  await testValidationWarning();
  await testLoginPageBlocked();
  await testStartApplicationScreen();
  await testHeuristicOnlyMode();
  await testReviewPage();
  await testGenericFormPage();
  await testMappingCacheSkipsAI();
  await testQuestionAnswerCached();
  await testNativeRadioGroups();
  await testDateWidgetThroughPipeline();
  await testPageChangeAutoProcess();
  console.log('\nALL FEATURE TESTS PASSED');
})().catch((e) => {
  console.error('\nFEATURE TEST FAILURE:', e.message);
  console.error(e);
  process.exit(1);
});