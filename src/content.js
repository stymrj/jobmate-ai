/**
 * content.js - Content Script Orchestrator
 * 
 * Main entry point for the JobMate AI autofill process.
 * Coordinates all modules: Navigator, Mapper, Filler.
 * Shows overlay UI for status and user confirmation.
 * Injected dynamically by detector.js (or on demand) on any page with a
 * job-application form.
 */

// Global state for the autofill session
const AutofillSession = {
  active: false,
  resumeData: null,
  currentStep: null,
  filledFields: [],
  skippedFields: [],
  errors: [],
};

/**
 * Initialize the content script.
 * Runs only on pages with a detectable job-application form.
 */
function initContentScript() {
  // Only show the overlay on pages the extension can actually fill.
  // (The guard flag is set only after a successful detection so that a retry
  //  after late DOM loading can still initialize.)
  if (window.__jobmateContentInit) return;
  if (!FormNavigator.isFillableFormPage()) {
    console.log('[JobMateAI] No fillable form detected; overlay suppressed.');
    return;
  }
  window.__jobmateContentInit = true;

  console.log('[JobMateAI] Content script loaded on', window.location.hostname);

  const step = FormNavigator.detectCurrentStep();
  const fieldCount = FormNavigator.getFormFields().length;

  trackEvent('page_detected', { site: window.location.hostname, fields: fieldCount });

  // Show a subtle indicator that the extension is active
  OverlayUI.init();
  OverlayUI.showStatus(`Detected: ${step.stepName} (${fieldCount} fillable field${fieldCount === 1 ? '' : 's'}).`);
  updateReadyStatus(step, fieldCount);

  // React to step/page changes (SPA navigation, manual "Next" clicks) so the
  // extension keeps working on every page of the application.
  setupPageChangeWatcher();
  AutofillSession.processedSignature = pageSignature();

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_AUTOFILL') {
      startAutofillProcess();
      sendResponse({ success: true });
    }
    if (message.type === 'PING') {
      sendResponse({ success: true, page: window.location.hostname });
    }
    return true;
  });
}

// The background worker notifies us right after dynamically injecting the
// engine files (detector found a form). Run init once scripts are in place.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'JOBMATE_ENGINE_READY') {
    try { initContentScript(); } catch (e) { console.warn('[JobMateAI] init failed:', e); }
    sendResponse({ ok: true });
  }
});

/**
 * Fire-and-forget analytics event via the background worker.
 */
function trackEvent(event, data = {}) {
  try {
    chrome.runtime.sendMessage({ type: 'TRACK_EVENT', event, data });
  } catch (e) {
    /* ignore */
  }
}

// ============================================================
// MAPPING CACHE (cuts AI API costs)
// ============================================================
//
// Remembers which value was used (and confirmed by the user via
// "Review & Continue") for each field label on each site. The next time the
// same label appears — later pages, or the next job application — the value
// is reused WITHOUT calling the AI. The cache is keyed per site host so
// option-dependent answers ("Yes"/"No", countries, …) never bleed between
// different application sites.

const MappingCache = {
  KEY: 'mappingCache',
  MAX_ENTRIES: 1500,

  /**
   * Build the storage key for a label.
   * @param {string} label
   * @param {number} occurrenceIndex - repeatable-entry index (Job Title #2)
   * @param {string} prefix - 'q:' for screening questions, '' for fields
   */
  _key(label, occurrenceIndex = 0, prefix = '') {
    const site = window.location.hostname || 'unknown';
    const normalized = String(label || '').toLowerCase().trim().slice(0, 150);
    const occurrence = occurrenceIndex > 0 ? ` #${occurrenceIndex}` : '';
    return `${site}::${prefix}${normalized}${occurrence}`.slice(0, 400);
  },

  async get(label, occurrenceIndex = 0, prefix = '') {
    const key = this._key(label, occurrenceIndex, prefix);
    const store = await chrome.storage.local.get(this.KEY);
    const map = store[this.KEY] || {};
    const entry = map[key];
    return entry ? entry.value : null;
  },

  async set(label, value, occurrenceIndex = 0, prefix = '') {
    if (!label || !value) return;
    const key = this._key(label, occurrenceIndex, prefix);
    const store = await chrome.storage.local.get(this.KEY);
    const map = store[this.KEY] || {};
    map[key] = { value: String(value).slice(0, 300), ts: Date.now() };

    // Cap the cache size (LRU-ish: drop oldest entries first).
    const keys = Object.keys(map);
    if (keys.length > this.MAX_ENTRIES) {
      keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
      for (const stale of keys.slice(0, keys.length - this.MAX_ENTRIES)) delete map[stale];
    }
    await chrome.storage.local.set({ [this.KEY]: map });
  },

  /**
   * Batch-save final values captured when the user confirms a page.
   */
  async setMany(entries) {
    if (!entries || entries.length === 0) return;
    const store = await chrome.storage.local.get(this.KEY);
    const map = store[this.KEY] || {};
    for (const entry of entries) {
      if (!entry || !entry.label || !entry.value) continue;
      map[this._key(entry.label, entry.occurrence || 0, entry.prefix || '')] = {
        value: String(entry.value).slice(0, 300),
        ts: Date.now()
      };
    }
    const keys = Object.keys(map);
    if (keys.length > this.MAX_ENTRIES) {
      keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
      for (const stale of keys.slice(0, keys.length - this.MAX_ENTRIES)) delete map[stale];
    }
    await chrome.storage.local.set({ [this.KEY]: map });
  }
};

/**
 * Refresh the overlay status once we know whether a resume is already stored.
 */
async function updateReadyStatus(step, fieldCount) {
  // Don't stomp on status shown once the user has actually started autofill.
  if (AutofillSession.active) return;

  // Authentication screens: inform the user and never auto-fill credentials.
  if (FormNavigator.isLoginPage()) {
    OverlayUI.showStatus(
      'Sign-in screen detected. Sign in manually — the extension never fills credentials.',
      'warning'
    );
    return;
  }
  if (FormNavigator.isCreateAccountPage()) {
    OverlayUI.showStatus(
      'Create Account screen detected. Complete account creation manually — the extension never fills credentials.',
      'warning'
    );
    return;
  }

  try {
    const resume = await getResumeData();
    const fileInfo = await getResumeFile();
    if (resume) {
      const name = [resume.firstName, resume.lastName].filter(Boolean).join(' ') || 'saved resume';
      const file = fileInfo && fileInfo.name ? ` · resume file: ${fileInfo.name}` : '';
      OverlayUI.showStatus(
        `Ready: ${step.stepName} (${fieldCount} fields) · ${name}${file}. Click "Start Autofill" in the popup.`,
        'success'
      );
    } else {
      OverlayUI.showStatus(
        `Detected: ${step.stepName} (${fieldCount} fields). Upload your resume in the extension popup to start autofill.`
      );
    }
  } catch (error) {
    OverlayUI.showStatus(`Detected: ${step.stepName} (${fieldCount} fields). Use the extension popup to start autofill.`);
  }
}

/**
 * Main autofill process.
 * Fills one page at a time, waits for user confirmation.
 */
async function startAutofillProcess() {
  try {
    // Never automate authentication.
    if (FormNavigator.isLoginPage() || FormNavigator.isCreateAccountPage()) {
      OverlayUI.showError('Sign in / create your account manually first. The extension does not fill credentials.');
      return;
    }

    // Step 1: Get resume data from storage
    const resumeData = await getResumeData();
    if (!resumeData) {
      OverlayUI.showError('No resume found yet. Open the extension popup and upload your resume (PDF/DOCX) to start autofill.');
      return;
    }
    AutofillSession.resumeData = resumeData;
    AutofillSession.active = true;

    trackEvent('autofill_started', { site: window.location.hostname });

    OverlayUI.showStatus('Starting autofill...');
    OverlayUI.expand();

    // Step 2: Process the current page
    await processCurrentPage();

  } catch (error) {
    console.error('[JobMateAI] Autofill error:', error);
    OverlayUI.showError(`Error: ${error.message}`);
  }
}

/**
 * Process the current page of the application.
 * Scans fields, maps data, fills fields, shows results.
 * Holds a processing guard so the page-change watcher never runs two fills
 * at once (the rendered-page signature is recorded inside after the form has
 * finished loading).
 */
async function processCurrentPage() {
  AutofillSession.processing = true;
  try {
    return await processCurrentPageInner();
  } finally {
    AutofillSession.processing = false;
  }
}

async function processCurrentPageInner() {
  const resumeData = AutofillSession.resumeData;
  
  // Detect current step
  const step = FormNavigator.detectCurrentStep();
  AutofillSession.currentStep = step;
  OverlayUI.showStatus(`Processing: ${step.stepName} (Step ${step.stepNumber || '?'}/${step.totalSteps || '?'})`);

  // Check if this is the review/submit page
  if (step.isReviewPage || step.isSubmitPage) {
    OverlayUI.showReviewPage();
    return;
  }

  // Wait for form to fully render
  await FormNavigator.waitForPageLoad(3000);
  // The page is now the one the user is actually seeing — remember its
  // signature so the page-change watcher does not double-process it.
  AutofillSession.processedSignature = pageSignature();

  // Handle the "Start Your Application" choice screen if present.
  if (FormNavigator.isStartApplicationScreen()) {
    const clicked = FormNavigator.clickApplyManually();
    OverlayUI.showStatus(clicked
      ? 'Selected "Apply Manually". Waiting for the form to load...'
      : 'Application choice screen detected — please choose "Apply Manually".');
    if (clicked) {
      await FormNavigator.waitForPageLoad(3000);
    }
  }

  // Work Experience / Education steps use repeatable entries: add rows to
  // match the number of entries on the resume before scanning fields.
  if (step.stepName === 'Work Experience' || step.stepName === 'Education') {
    await ensureRepeatableRows(step, resumeData);
  }

  // Scan for form fields
  const fields = FormNavigator.getFormFields();
  OverlayUI.showStatus(`Found ${fields.length} fields on this page.`);

  if (fields.length === 0) {
    OverlayUI.showStatus('No fillable fields found on this page. Click "Next" to continue.');
    OverlayUI.showNavigationButtons(true);
    return;
  }

  // Map and fill each field
  const results = [];
  const labelOccurrences = {}; // tracks repeats of the same label
  const context = { step: step.stepName };

  // Phase 1 — resolve every field's value. AI calls run in parallel
  // (concurrency-limited) so one slow provider call no longer stalls the rest.
  const tasks = [];
  for (const field of fields) {
    const occurrenceKey = (field.label || '').toLowerCase().trim();
    const occurrenceIndex = labelOccurrences[occurrenceKey] || 0;
    labelOccurrences[occurrenceKey] = occurrenceIndex + 1;
    tasks.push({ field, occurrenceIndex });
  }

  OverlayUI.showStatus(`Resolving ${tasks.length} field${tasks.length === 1 ? '' : 's'} (AI calls run in parallel)...`);
  const resolved = await withConcurrency(tasks, 4, async (task) => {
    const { field, occurrenceIndex } = task;

    // Resume/CV upload fields: attach the stored resume file directly.
    if (field.type === 'file') {
      return resolveFileField(field);
    }

    // Screening / EEO / Yes-No questions use the question-answer AI prompt.
    if (FormNavigator.isQuestionField(field, step)) {
      return answerQuestionField(field, resumeData);
    }

    // Map the field to resume data (heuristic → cache → AI).
    const mapping = await FieldMapper.mapField(
      field.label, field.type, field.options, resumeData, occurrenceIndex, context, MappingCache
    );
    return {
      value: mapping.value,
      confidence: mapping.confidence,
      source: mapping.source,
      file: null
    };
  });

  // Phase 2 — fill fields sequentially, keeping DOM order for the results UI.
  OverlayUI.showStatus('Filling fields...');
  for (let i = 0; i < tasks.length; i++) {
    const { field, occurrenceIndex } = tasks[i];
    const resolution = resolved[i];

    if (resolution.error) {
      results.push({
        label: field.label,
        value: '',
        confidence: 'error',
        element: field.element,
        occurrence: occurrenceIndex,
        filled: false,
        status: 'error',
        error: resolution.error.message || String(resolution.error)
      });
      continue;
    }

    if (resolution.file) {
      const filled = await FormFiller.uploadFile(field.element, resolution.file);
      results.push({
        label: field.label,
        value: resolution.value,
        confidence: resolution.confidence || 'high',
        source: resolution.source,
        element: field.element,
        occurrence: occurrenceIndex,
        filled,
        status: filled ? 'filled' : 'skipped'
      });
      continue;
    }

    if (resolution.value && resolution.confidence !== 'skip') {
      const filled = await FormFiller.fillField(field, resolution.value);
      results.push({
        label: field.label,
        value: resolution.value,
        confidence: resolution.confidence,
        source: resolution.source,
        element: field.element,
        groupRadios: field.groupRadios,
        occurrence: occurrenceIndex,
        filled,
        status: filled ? 'filled' : 'skipped'
      });
    } else {
      results.push({
        label: field.label,
        value: '',
        confidence: resolution.confidence || 'low',
        source: resolution.source,
        element: field.element,
        groupRadios: field.groupRadios,
        occurrence: occurrenceIndex,
        filled: false,
        status: 'no-match'
      });
    }
  }

  // Validate required fields after filling.
  const missingRequired = FormNavigator.getEmptyRequiredFields();
  if (missingRequired.length > 0) {
    OverlayUI.showStatus(
      `${missingRequired.length} required field(s) still empty (e.g. "${missingRequired[0].label}").`,
      'warning'
    );
  }

  // Show results in overlay
  AutofillSession.filledFields = results;
  OverlayUI.showFieldResults(results);
  OverlayUI.showNavigationButtons(!step.isSubmitPage);

  const filledCount = results.filter((r) => r.filled).length;
  trackEvent('page_filled', { site: window.location.hostname, filled: filledCount, total: results.length });
}

/**
 * Resolve the stored resume file for a Resume/CV upload field.
 * Returns { value, file, confidence, source } — the actual DOM upload happens
 * in the sequential fill phase.
 */
async function resolveFileField(field) {
  try {
    const fileInfo = await getResumeFile();
    if (fileInfo && fileInfo.base64 && fileInfo.name) {
      const bytes = Uint8Array.from(atob(fileInfo.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], fileInfo.name, {
        type: fileInfo.type || 'application/octet-stream'
      });
      return { value: fileInfo.name, file, confidence: 'high', source: 'file' };
    }
  } catch (error) {
    console.error(`[JobMateAI] Error preparing file for field "${field.label}":`, error);
  }
  return { value: '', file: null, confidence: 'low', source: 'no-file' };
}

/**
 * Answer a screening / EEO / Yes-No question WITHOUT filling the DOM.
 * Tries the mapping cache first (a previously confirmed answer — no AI cost),
 * then the AI question prompt; falls back to heuristics so the extension
 * still works without an API key. The fill happens in the sequential phase.
 */
async function answerQuestionField(field, resumeData) {
  // Step 1: Reuse a previously confirmed answer for this question.
  try {
    const cachedAnswer = await MappingCache.get(field.label, 0, 'q:');
    if (cachedAnswer) {
      const value = findBestQuestionValue(cachedAnswer, field);
      if (value) return { value, confidence: 'high', source: 'cache' };
    }
  } catch (error) {
    console.warn(`[JobMateAI] Question cache lookup failed for "${field.label}":`, error.message);
  }

  // Step 2: AI question prompt.
  try {
    const answer = await AIService.answerQuestion(field.label, field.options, resumeData);
    if (answer && answer.answer) {
      const value = findBestQuestionValue(answer.answer, field);
      if (value) MappingCache.set(field.label, value, 0, 'q:').catch(() => {});
      return { value: value || answer.answer, confidence: answer.confidence || 'medium', source: 'ai-question' };
    }
  } catch (error) {
    console.warn(`[JobMateAI] AI question failed for "${field.label}", using heuristics:`, error.message);
  }

  // Step 3: Heuristic fallback: Yes/No booleans and common EEO answers.
  const heuristicValue = FieldMapper.heuristicMatch(field.label, resumeData, 0, { step: 'Questions' });
  const value = findBestQuestionValue(heuristicValue, field);
  if (value) return { value, confidence: 'medium', source: 'heuristic-question' };

  return { value: '', confidence: 'low', source: 'unanswered' };
}

/**
 * Run `worker(item, index)` over every item with at most `limit` concurrent
 * executions. Results keep input order; per-item errors are captured on the
 * result as { error } instead of rejecting the whole batch.
 */
async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (error) {
        results[i] = { error };
      }
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(run());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Pick the best option from a question answer, restricting the answer to the
 * widget's own options when available (e.g. Yes/No, Decline to self-identify).
 */
function findBestQuestionValue(answer, field) {
  if (!answer) return null;
  if (field.type === 'radio' && Array.isArray(field.options) && field.options.length > 0) {
    const matched = FieldMapper.findBestOption(answer, field.options);
    if (matched) return matched;
  }
  if (field.type === 'dropdown' && Array.isArray(field.options) && field.options.length > 0) {
    const matched = FieldMapper.findBestOption(answer, field.options);
    if (matched) return matched;
  }
  if (field.type === 'checkbox') return answer;
  return answer;
}

/**
 * For Work Experience / Education steps, add repeatable entries until the form
 * has one row per resume entry.
 */
async function ensureRepeatableRows(step, resumeData) {
  const arrayName = step.stepName === 'Education' ? 'education' : 'workExperience';
  const entries = (resumeData[arrayName] || []).filter(Boolean);
  if (entries.length <= 1) return;

  const hintLabels = step.stepName === 'Education'
    ? ['degree', 'school', 'field of study', 'gpa']
    : ['job title', 'company', 'employer', 'start date'];

  const currentEntries = FormNavigator.countSectionEntries(hintLabels);
  const needed = Math.max(0, entries.length - currentEntries);
  if (needed <= 0) return;

  const addButtons = FormNavigator.getAddButtons();
  if (addButtons.length === 0) {
    console.warn('[JobMateAI] Repeatable section detected but no "Add" button found.');
    return;
  }

  OverlayUI.showStatus(`Adding ${needed} repeatable ${arrayName} entr${needed === 1 ? 'y' : 'ies'}...`);
  for (let i = 0; i < needed; i++) {
    const btn = addButtons[i % addButtons.length];
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Signature of the currently rendered application step. Used to detect page
 * changes without listening to navigation events (SPA steps, iframe-like
 * replacements, "Next" clicked on the site itself, etc.).
 */
function pageSignature() {
  const titleEl = document.querySelector(
    '[data-automation-id="pageHeaderTitle"], h1, h2, [data-automation-id*="title"]'
  );
  const title = titleEl ? titleEl.textContent.trim() : '';
  const formCount = document.querySelectorAll('form, [data-automation-id="formArea"]').length;
  return window.location.href + '|' + title + '|' + formCount;
}

/**
 * Watch for page/step changes (SPA route changes, manual "Next" clicks, late
 * DOM renders) and re-process automatically so the extension always works on
 * the page the user is actually seeing.
 */
function setupPageChangeWatcher() {
  let debounce = null;
  let lastReprocess = 0;
  let retryTimer = null;

  const check = (forced) => {
    onPossiblePageChange(lastReprocess, forced).then((t) => {
      if (typeof t === 'number' && t > 0) lastReprocess = t;
      // Rate-limited (rapid DOM churn): retry once after the gap so a real
      // page change is never silently dropped.
      if (t === -1) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => check(true), Math.max(3000 - (Date.now() - lastReprocess) + 150, 250));
      }
    });
  };

  // DOM changes (SPA step re-renders, late-loaded fields, manual navigation).
  if (document.body) {
    const observer = new MutationObserver(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => check(false), 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[JobMateAI] Page-change watcher armed');
  }

  // URL changes without DOM mutations (pushState/replaceState/popstate).
  // Explicit navigation is never rate-limited: clicking "Next"/"Back" must
  // always re-process the page the user just landed on.
  const patchHistory = (method) => {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      setTimeout(() => check(true), 0);
      return result;
    };
  };
  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', () => check(true));
}

/**
 * React to a possible page change: refresh the status banner, and if autofill
 * is active, process the newly rendered step. Returns the timestamp of the
 * last reprocess (rate-limited so flapping DOMs don't cause a hot loop).
 * Returns -1 when a reprocess was rate-limited so the caller can retry once.
 */
async function onPossiblePageChange(previousReprocess, forced = false) {
  const signature = pageSignature();
  if (signature === AutofillSession.processedSignature) {
    return previousReprocess; // nothing changed since we last handled it
  }

  // While a fill is running, let it finish; it will set the new signature.
  if (AutofillSession.processing) return previousReprocess;

  // Rate-limit automatic reprocessing (generous; AI fills are not instant).
  // Explicit navigation (popstate/pushState) bypasses the limit — the user
  // clearly wants the new page processed right now.
  const now = Date.now();
  const rateLimited = now - (previousReprocess || 0) < 3000;
  if (rateLimited && !forced) {
    return -1; // retry after the gap
  }

  const step = FormNavigator.detectCurrentStep();
  const fieldCount = FormNavigator.getFormFields().length;

  if (AutofillSession.active) {
    if (!rateLimited || forced) {
      const timestamp = now;
      try {
        await processCurrentPage();
      } catch (error) {
        console.error('[JobMateAI] Auto-reprocess failed:', error);
      }
      return timestamp;
    }
    return previousReprocess;
  }

  // Not autofilling: just refresh the banner so the user sees the extension
  // is live on the new step.
  AutofillSession.processedSignature = signature;
  updateReadyStatus(step, fieldCount);
  return previousReprocess;
}

/**
 * Get resume data from chrome.storage via background.
 */
function getResumeData() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_RESUME' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response.result);
    });
  });
}

/**
 * Get the stored resume file (name/type/base64) from the background worker.
 */
function getResumeFile() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_RESUME_FILE' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response.result);
    });
  });
}

/**
 * Navigate to next page after user confirmation.
 */
async function navigateToNextPage() {
  // The user just reviewed this page — capture the final values (including
  // any corrections they made) so the next application reuses them without
  // calling the AI again.
  saveFilledValues();

  OverlayUI.showStatus('Navigating to next page...');
  const success = await FormNavigator.clickNext();
  if (success) {
    // Wait for new page to load, then process it
    await new Promise(r => setTimeout(r, 1500));
    await processCurrentPage();
  } else {
    OverlayUI.showError('Could not find the Next button. Please navigate manually.');
  }
}

/**
 * Read the current value of a filled field element, ready for the cache.
 * Returns null when the element is gone or not meaningfully readable.
 */
function readElementValue(field) {
  const el = field.element;
  if (!el || !el.isConnected) return null;

  // Resume/CV upload fields are handled separately — never cached.
  if (field.type === 'file') return null;

  // Split date widgets read back only the month part; keep the value the
  // filler produced (already normalized like "01/2019" or ISO).
  if (field.type === 'date') return field.value || null;

  // Plain radio groups carry all their radios on the field object.
  if (field.groupRadios && field.groupRadios.length > 0) {
    const checked = field.groupRadios.find((r) => r.checked);
    if (!checked) return null;
    const label = checked.closest('label');
    const text = label ? label.textContent.trim() : '';
    return text || checked.value || null;
  }

  const tag = el.tagName;
  if (tag === 'SELECT') {
    const idx = el.selectedIndex;
    return idx >= 0 ? (el.options[idx].text || el.options[idx].value) : null;
  }
  if (tag === 'INPUT') {
    if (el.type === 'radio') {
      if (!el.checked) return null;
      const label = el.closest('label');
      const text = label ? label.textContent.trim() : '';
      return text || el.value;
    }
    if (el.type === 'checkbox') {
      if (!el.checked) return null;
      const label = el.closest('label');
      const text = label ? label.textContent.trim() : '';
      return text || el.value;
    }
    return el.value;
  }
  if (tag === 'TEXTAREA') return el.value;
  return null;
}

/**
 * Save the final (possibly user-corrected) values of the last filled page
 * into the mapping cache. Fire-and-forget: never blocks navigation.
 */
function saveFilledValues() {
  const results = AutofillSession.filledFields || [];
  if (results.length === 0) return;
  const entries = [];
  for (const result of results) {
    const value = readElementValue(result);
    if (value && String(value).trim()) {
      entries.push({ label: result.label, value: String(value).trim(), occurrence: result.occurrence || 0 });
    }
  }
  if (entries.length > 0) {
    MappingCache.setMany(entries).catch((e) => console.warn('[JobMateAI] Could not save mapping cache:', e.message));
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
