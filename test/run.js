/**
 * test/run.js - Base end-to-end tests for the JobMate AI extension.
 */
const {
  resumeData,
  buildIntroduceYourselfPage,
  buildJobSearchPage,
  setup,
  waitFor,
  assert
} = require('./helpers');

async function testFieldScan() {
  console.log('\n=== TEST 4: Field scanning on Introduce Yourself ===');
  const t = await setup({ resumeData });
  const fields = t.getGlobal('FormNavigator').getFormFields();
  assert(fields.length >= 10, `scanned ${fields.length} fields`);
  const labels = fields.map((f) => f.label);
  assert(labels.includes('First Name') && labels.includes('Resume/CV'), 'scans personal + resume fields');
}

async function testStepDetection() {
  console.log('\n=== TEST 3: Step detection on the Introduce Yourself page ===');
  const t = await setup({ resumeData });
  const step = t.getGlobal('FormNavigator').detectCurrentStep();
  assert(step.stepName === 'Introduce Yourself', `stepName is "Introduce Yourself" (got "${step.stepName}")`);
  assert(!step.isReviewPage && !step.isSubmitPage, 'not detected as review/submit');
}

async function testIntroduceYourselfAutofill() {
  console.log('\n=== TEST 1: Autofill on the Introduce Yourself page ===');
  const t = await setup({ resumeData });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 12000);

  assert(t.valueOf('input[aria-label="First Name"]') === 'Jane', 'first name filled');
  assert(t.valueOf('input[aria-label="Last Name"]') === 'Smith', 'last name filled');
  assert(t.valueOf('input[aria-label="Email"]') === 'jane.smith@example.com', 'email filled');
  assert(t.valueOf('select[data-automation-id="countrySelect"]') === 'US', 'country dropdown filled');
}

async function testNoResumeData() {
  console.log('\n=== TEST 2: No resume data in storage ===');
  const t = await setup({ resumeData: null });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  await waitFor(() => t.statusText() && t.statusText().includes('Upload your resume'));
  t.triggerAutofill();
  await waitFor(() => t.statusText() && t.statusText().includes('No resume'));
  assert(/No resume/.test(t.statusText()), 'shows guidance to upload resume');
}

async function testNonFormPageNoOverlay() {
  console.log('\n=== TEST 5: Job search page (no form) ===');
  const t = await setup({ resumeData, pageHtml: buildJobSearchPage(), url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday' });
  await t.sleep(800);
  assert(!t.overlayPanel(), 'overlay NOT present on a non-form page');
}

async function testResumeFileFill() {
  console.log('\n=== TEST 6: Resume/CV file field gets the stored resume ===');
  const tinyPdf = Buffer.from('%PDF-1.4\nfake').toString('base64');
  const t = await setup({ resumeData, resumeFile: { name: 'resume.pdf', type: 'application/pdf', base64: tinyPdf } });
  await waitFor(() => t.overlayPanel() && t.messageListeners.length > 0);
  t.triggerAutofill();
  await waitFor(() => t.resultsHTML() && t.resultsHTML().length > 0, 12000);

  const fileInput = t.window.document.querySelector('input[type="file"]');
  assert(fileInput && fileInput.files.length === 1, 'resume file attached to Resume/CV input');
  assert(/resume\.pdf/.test(t.resultsHTML()), 'results report the resume filename');
}

(async () => {
  await testFieldScan();
  await testStepDetection();
  await testIntroduceYourselfAutofill();
  await testNoResumeData();
  await testNonFormPageNoOverlay();
  await testResumeFileFill();
  console.log('\nALL BASE TESTS PASSED');
})().catch((e) => {
  console.error('\nTEST FAILURE:', e.message);
  console.error(e);
  process.exit(1);
});