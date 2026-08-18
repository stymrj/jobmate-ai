/**
 * navigator.js - Form Navigator Module
 * 
 * Handles Workday form structure detection, field scanning,
 * multi-step navigation, and dynamic content observation.
 */

const FormNavigator = {

  // Common Workday step indicators
  STEP_PATTERNS: [
    { pattern: /my\s*info|personal|contact/i, name: 'My Information' },
    { pattern: /experience|work\s*history|employment/i, name: 'Work Experience' },
    { pattern: /education|academic/i, name: 'Education' },
    { pattern: /skill|qualification|competenc/i, name: 'Skills' },
    { pattern: /question|screening|additional/i, name: 'Questions' },
    { pattern: /review|summary|confirm/i, name: 'Review' },
    { pattern: /voluntary|self.?identify|eeo|equal/i, name: 'Voluntary Disclosures' },
    { pattern: /introduce|prospect|tell\s*us?\s*about\s*you|about\s*you/i, name: 'Introduce Yourself' },
    { pattern: /resume|cv|upload/i, name: 'Resume' },
    { pattern: /cover\s*letter/i, name: 'Cover Letter' },
  ],

  // Month/Day/Year sub-controls of a Workday split date widget. They are
  // handled as one 'date' field (scanDateWidgets) and skipped individually.
  DATE_WIDGET_PARTS: '[data-automation-id*="dateSectionMonth"], [data-automation-id*="dateSectionDay"], [data-automation-id*="dateSectionYear"]',

  // The widget container itself (parts excluded — they also match "*=").
  DATE_WIDGET_CONTAINER: '[data-automation-id*="dateSection"]' +
    ':not([data-automation-id*="dateSectionMonth"])' +
    ':not([data-automation-id*="dateSectionDay"])' +
    ':not([data-automation-id*="dateSectionYear"])',

  // Selectors for common form elements (Workday automation ids + generic)
  SELECTORS: {
    // Step/progress indicators
    progressBar: '[data-automation-id="progressBar"], [role="progressbar"], .css-progress',
    stepIndicator: '[data-automation-id="stepHeader"], [data-automation-id="navigationBar"] li, [role="tablist"] [role="tab"], .wizard-steps li, .progress-steps li',
    currentStep: '[aria-current="step"], [data-automation-id="activeStep"], .css-current-step',

    // Form fields (native + Workday custom)
    textInput: 'input[type="text"]:not([type="hidden"]), input:not([type]):not([hidden]), [data-automation-id="textInputBox"], [data-automation-id="textInput"]',
    emailInput: 'input[type="email"]',
    telInput: 'input[type="tel"], input[type="phone"]',
    textarea: 'textarea, [data-automation-id="richTextArea"], [contenteditable="true"]',
    select: 'select, [data-automation-id="selectWidget"], [data-automation-id="multiselectWidget"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    fileInput: 'input[type="file"]',
    dateInput: 'input[type="date"], input[type="month"], input[data-automation-id*="date"], [data-automation-id="dateSectionMonth-input"]',

    // Navigation buttons
    nextButton: 'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="nextButton"]',
    previousButton: 'button[data-automation-id="bottom-navigation-previous-button"], button[data-automation-id="previousButton"]',
    submitButton: 'button[data-automation-id="bottom-navigation-next-button"]:last-of-type, button[type="submit"]',
    saveButton: 'button[data-automation-id="saveButton"]',
    addButton: 'button[data-automation-id*="add"], [data-automation-id*="addItemButton"]',

    // Workday date widget sub-controls
    dateMonth: '[data-automation-id*="dateSectionMonth"]',
    dateDay: '[data-automation-id*="dateSectionDay"]',
    dateYear: '[data-automation-id*="dateSectionYear"]',

    // Auth / account screens (never auto-filled)
    loginPassword: 'input[type="password"]',

    // Page containers
    formContainer: '[data-automation-id="formArea"], [data-automation-id="applicationFormArea"], form, main',
    pageTitle: '[data-automation-id="pageHeaderTitle"], h2[data-automation-id], h1, h2',
  },

  // Words that indicate a screening / EEO / voluntary question.
  QUESTION_KEYWORDS: /gender|sex|race|ethnic|veteran|disabilit|self.?identif|protected|how did you hear|source of referral|sponsorship|work authorization|legally authorized|authorized to work|willing to relocate|relocate|willingness to|military|marital|national origin|equal opportunity|eeo|consent|age\b|school.?leaver|notice period/i,

  /**
   * Detect which step of the application we're currently on.
   * @returns {object} { stepName, stepNumber, totalSteps, isReviewPage, isSubmitPage }
   */
  detectCurrentStep() {
    const result = {
      stepName: 'Unknown',
      stepNumber: 0,
      totalSteps: 0,
      isReviewPage: false,
      isSubmitPage: false
    };

    // Try to read step from progress bar / navigation
    const stepElements = document.querySelectorAll(this.SELECTORS.stepIndicator);
    if (stepElements.length > 0) {
      result.totalSteps = stepElements.length;
      stepElements.forEach((el, index) => {
        if (el.matches('[aria-current="step"], .css-current-step') || 
            el.getAttribute('aria-selected') === 'true') {
          result.stepNumber = index + 1;
          result.stepName = el.textContent.trim();
        }
      });
    }

    // Try to detect from page title
    const pageTitle = document.querySelector(this.SELECTORS.pageTitle);
    if (pageTitle) {
      const titleText = pageTitle.textContent.trim();
      for (const step of this.STEP_PATTERNS) {
        if (step.pattern.test(titleText)) {
          result.stepName = step.name;
          break;
        }
      }
    }

    // Fall back to URL path hints (introduceYourself, apply, etc.)
    if (result.stepName === 'Unknown') {
      const path = window.location.pathname.toLowerCase();
      if (/introduce/.test(path)) {
        result.stepName = 'Introduce Yourself';
      } else if (/apply/.test(path)) {
        result.stepName = 'Application';
      }
    }

    // Detect review/submit page
    const pageText = document.body.innerText.toLowerCase();
    result.isReviewPage = /review.*application|application.*review|summary/i.test(pageText) && 
                          document.querySelectorAll('input:not([type="hidden"])').length < 3;
    result.isSubmitPage = result.isReviewPage || 
                          !!document.querySelector('button[data-automation-id="submitButton"]');

    return result;
  },

  /**
   * Scan the current page for all fillable form fields.
   * Returns an array of field objects with element, type, label, and options.
   * @returns {Array<object>}
   */
  getFormFields() {
    const fields = [];
    const seen = new Set(); // Avoid duplicates

    // Scan each field type (Workday selectors + native controls)
    this.scanFields(fields, seen, this.SELECTORS.textInput, 'text');
    this.scanFields(fields, seen, this.SELECTORS.emailInput, 'email');
    this.scanFields(fields, seen, this.SELECTORS.telInput, 'tel');
    this.scanFields(fields, seen, this.SELECTORS.textarea, 'textarea');
    this.scanFields(fields, seen, this.SELECTORS.select, 'dropdown');
    this.scanFields(fields, seen, this.SELECTORS.dateInput, 'date');
    this.scanFields(fields, seen, this.SELECTORS.fileInput, 'file');
    this.scanFields(fields, seen, this.SELECTORS.checkbox, 'checkbox');

    // Generic catch-all: any native form control not already seen. This makes
    // the engine work on arbitrary career sites (Greenhouse, Lever, ...).
    this.scanFields(fields, seen,
      'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], ' +
      'input[type="date"], input[type="month"], input[type="number"], ' +
      'input[type="url"], input[type="search"], ' +
      'textarea, select, input[type="checkbox"], input[type="file"]',
      null);

    // Scan radio groups (group them together)
    this.scanRadioGroups(fields, seen);

    // Scan Workday split date widgets (Month/Day/Year) as a single date field.
    this.scanDateWidgets(fields, seen);

    return fields;
  },

  /**
   * Scan Workday split date widgets as ONE date field. The Month/Day/Year
   * sub-controls themselves are skipped in scanFields (see DATE_WIDGET_PARTS)
   * so they never appear as separate dropdown/text fields.
   */
  scanDateWidgets(fields, seen) {
    const containers = document.querySelectorAll(FormNavigator.DATE_WIDGET_CONTAINER);
    for (const container of containers) {
      if (this.isHidden(container) || seen.has(container)) continue;
      const parts = container.querySelectorAll(FormNavigator.DATE_WIDGET_PARTS);
      if (parts.length < 2) continue;
      seen.add(container);
      parts.forEach((part) => seen.add(part));
      fields.push({
        element: container,
        type: 'date',
        label: this.getFieldLabel(container),
        options: [],
        required: false,
        automationId: container.getAttribute('data-automation-id') || ''
      });
    }
  },

  /**
   * Scan DOM for fields matching a selector. When `type` is null the type is
   * inferred from the element itself.
   */
  scanFields(fields, seen, selector, type) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      // Skip hidden, disabled, or already-seen elements
      if (this.isHidden(el) || el.disabled || seen.has(el)) continue;
      // Skip the Month/Day/Year sub-controls of split date widgets — they are
      // represented as one 'date' field by scanDateWidgets.
      if (el.closest && el.closest(FormNavigator.DATE_WIDGET_CONTAINER)) {
        const widget = el.closest(FormNavigator.DATE_WIDGET_CONTAINER);
        if (widget.querySelectorAll(this.DATE_WIDGET_PARTS).length >= 2) {
          seen.add(el);
          continue;
        }
      }
      seen.add(el);

      let resolvedType = type;
      if (resolvedType === null) {
        resolvedType = this.inferType(el);
        if (!resolvedType) continue;
      }

      const label = this.getFieldLabel(el);
      const options = resolvedType === 'dropdown' ? this.getDropdownOptions(el) : [];

      fields.push({
        element: el,
        type: resolvedType,
        label,
        options,
        required: el.required || el.getAttribute('aria-required') === 'true',
        automationId: el.getAttribute('data-automation-id') || ''
      });
    }
  },

  /**
   * Infer the field type from a native element's tag/attributes.
   */
  inferType(el) {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return 'dropdown';
    if (tag === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      if (t === 'email') return 'email';
      if (t === 'tel') return 'tel';
      if (t === 'date' || t === 'month') return 'date';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'file') return 'file';
      if (t === 'radio') return 'radio';
      return 'text';
    }
    return null;
  },

  /**
   * Scan for radio button groups: ARIA radiogroups (Workday) AND plain HTML
   * groups (generic career sites) where radios are grouped by name.
   */
  scanRadioGroups(fields, seen) {
    // Case 1: ARIA radiogroup containers (Workday / accessible widgets).
    const groups = document.querySelectorAll('[role="radiogroup"]');
    for (const group of groups) {
      if (this.isHidden(group) || seen.has(group)) continue;
      seen.add(group);

      const label = this.getFieldLabel(group);
      const options = Array.from(group.querySelectorAll('[role="radio"]'))
        .map(r => (r.textContent || r.getAttribute('aria-label') || '').trim())
        .filter(Boolean);

      fields.push({
        element: group,
        type: 'radio',
        label,
        options,
        required: group.getAttribute('aria-required') === 'true',
        automationId: group.getAttribute('data-automation-id') || ''
      });
    }

    // Case 2: Plain <input type="radio"> grouped by name (no ARIA role).
    // Radios inside a [role="radiogroup"] are already handled by Case 1 —
    // scanning them again would produce duplicate fields and duplicate AI calls.
    const radioGroups = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (this.isHidden(r) || r.disabled || seen.has(r)) continue;
      seen.add(r);
      if (r.closest && r.closest('[role="radiogroup"]')) continue;
      const scope = r.form ? 'f' : 'd';
      const key = scope + ':' + (r.name || ('#' + (r.id || '')));
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key).push(r);
    }
    for (const radios of radioGroups.values()) {
      const label = this.findRadioGroupLabel(radios) || this.getFieldLabel(radios[0]);
      const options = radios
        .map(r => this.getFieldLabel(r).trim())
        .filter(Boolean);
      fields.push({
        element: radios[0],
        groupRadios: radios,
        type: 'radio',
        label,
        options,
        required: radios[0].required || radios[0].getAttribute('aria-required') === 'true',
        automationId: ''
      });
    }
  },

/**
   * Find the question text that labels a plain radio group: walk up from the
   * radios until an ancestor contains non-option text (with all controls and
   * option <label>s stripped).
   */
  findRadioGroupLabel(radios) {
    if (!radios || radios.length === 0) return null;
    let container = radios[0].parentElement;
    let hops = 0;
    while (container && container !== document.body && hops < 10) {
      hops++;
      // The radio's own <label> is option text ("Yes"), not the question.
      if (container.tagName === 'LABEL') {
        container = container.parentElement;
        continue;
      }
      const clone = container.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button, label').forEach((el) => el.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 1 && text.length < 150) return text;
      container = container.parentElement;
    }
    return null;
  },

  /**
   * Get the label text for a form field.
   * Tries multiple strategies for both Workday's dynamic DOM and plain HTML.
   */
  getFieldLabel(element) {
    // Strategy 1: aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length > 1) return ariaLabel;

    // Strategy 2: aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // Strategy 3: Explicit <label> via for attribute
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.textContent.trim();
    }

    // Strategy 4: Wrapping <label> (label contains the control)
    if (element.closest && element.closest('label')) {
      const label = element.closest('label');
      if (label) {
        const clone = label.cloneNode(true);
        clone.querySelectorAll('input, select, textarea').forEach((el) => el.remove());
        const text = (clone.textContent || '').trim();
        if (text) return text;
      }
    }

    // Strategy 5: Parent/ancestor label
    let parent = element.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const label = parent.querySelector('label');
      if (label && !label.querySelector('input, select, textarea')) {
        return label.textContent.trim();
      }
      // Check for Workday label patterns
      const wdLabel = parent.querySelector('[data-automation-id*="label"], [data-automation-id*="Label"]');
      if (wdLabel) return wdLabel.textContent.trim();
      parent = parent.parentElement;
    }

    // Strategy 6: Fieldset legend
    if (element.closest) {
      const fieldset = element.closest('fieldset');
      const legend = fieldset && fieldset.querySelector('legend');
      if (legend && legend.textContent.trim()) return legend.textContent.trim();
    }

    // Strategy 7: Placeholder text
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder;

    // Strategy 8: Previous sibling text (label-prefix markup, e.g. <div><span>First Name</span><input></div>)
    if (element.previousElementSibling) {
      const prev = element.previousElementSibling;
      const text = (prev.textContent || '').trim();
      if (text && text.length > 1 && text.length < 80 && !prev.querySelector('input, select, textarea')) {
        return text;
      }
    }

    // Strategy 9: data-automation-id / name as last resort
    const autoId = element.getAttribute('data-automation-id') || element.getAttribute('name') || '';
    if (autoId) return autoId.replace(/[-_]/g, ' ');

    return 'Unknown Field';
  },

  /**
   * Get available options for a dropdown/select element.
   */
  getDropdownOptions(element) {
    // Native select
    if (element.tagName === 'SELECT') {
      return Array.from(element.options)
        .map(opt => opt.text.trim())
        .filter(text => text && !text.includes('Select'));
    }
    // Custom dropdown - options may not be loaded yet
    return [];
  },

  /**
   * Check if an element is hidden/invisible.
   * NOTE: offsetParent is null for position:fixed elements (e.g. forms inside
   * modal dialogs) even when fully visible — those must NOT be treated as
   * hidden, or whole application forms would be skipped.
   */
  isHidden(element) {
    if (!element) return true;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (style.position !== 'fixed' && element.offsetParent === null) return true;
    return false;
  },

  /**
   * Click the "Next" / "Continue" button to go to the next step.
   * @returns {Promise<boolean>} - True if navigation was successful
   */
  async clickNext() {
    // Try various next button selectors (Workday automation ids + native)
    const selectors = [
      'button[data-automation-id="bottom-navigation-next-button"]',
      'button[data-automation-id="nextButton"]',
      'button[data-automation-id="submitButton"]',
      'button[type="submit"]',
      'button:has(> span:contains("Next"))',
      'button:has(> span:contains("Continue"))',
      'button:has(> span:contains("Save and Continue"))',
      'button:has(> span:contains("Submit"))',
      'a[role="button"][href*="apply"], a[data-automation-id="jobApplyButton"]',
    ];

    let button = null;
    for (const sel of selectors) {
      try {
        button = document.querySelector(sel);
        if (button && !button.disabled) break;
      } catch (e) {
        // :has/:contains may not be supported, fall back
        continue;
      }
    }

    // Fallback: find button by text content (visible, enabled)
    if (!button) {
      const candidates = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
      for (const btn of candidates) {
        if (this.isHidden(btn)) continue;
        const text = (btn.textContent || btn.value || '').toLowerCase().trim();
        if ((text.includes('next') || text.includes('continue') || text.includes('save and continue') || text.includes('submit'))
            && !btn.disabled) {
          button = btn;
          break;
        }
      }
    }

    if (!button) {
      console.warn('[Navigator] Could not find Next button');
      return false;
    }

    button.click();
    await this.waitForPageLoad();
    return true;
  },

  /**
   * Wait for the page to finish loading/rendering new content.
   * Uses MutationObserver to detect when DOM changes settle.
   * @param {number} timeout - Maximum wait time in ms (default 5000)
   * @returns {Promise<void>}
   */
  waitForPageLoad(timeout = 5000) {
    return new Promise((resolve) => {
      let timer = null;
      let settled = null;

      const observer = new MutationObserver(() => {
        // Reset the settle timer on each mutation
        if (settled) clearTimeout(settled);
        settled = setTimeout(() => {
          observer.disconnect();
          if (timer) clearTimeout(timer);
          resolve();
        }, 800); // Consider page loaded after 800ms of no DOM changes
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      // Timeout fallback
      timer = setTimeout(() => {
        observer.disconnect();
        if (settled) clearTimeout(settled);
        resolve();
      }, timeout);
    });
  },

  /**
   * Check if there's a "Previous" button available.
   */
  hasPreviousButton() {
    return !!document.querySelector(
      'button[data-automation-id="bottom-navigation-previous-button"], ' +
      'button[data-automation-id="previousButton"]'
    );
  },

  /**
   * Detect a job application page: either a dedicated ATS (Workday path) or a
   * generic page containing a real form with job-application copy.
   */
  isFillableFormPage() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/apply') || path.includes('/introduceyourself')) return true;

    if (document.querySelector('[data-automation-id="formArea"], [data-automation-id="applicationFormArea"]')) {
      return true;
    }

    // Generic sites: need both a form and a job-application signal.
    const pageText = (document.body && document.body.innerText || document.title || '');
    const jobish = /(apply|application|career|candidat|job|position|resume|hiring|recruit)/i.test(pageText.slice(0, 3000));
    if (!jobish) return false;

    const hasFormSubmit = !!document.querySelector(
      'button[data-automation-id="bottom-navigation-next-button"], ' +
      'button[data-automation-id="nextButton"], ' +
      'button[data-automation-id="submitButton"], ' +
      'button[type="submit"]'
    );
    return hasFormSubmit && this.getFormFields().length >= 3;
  },

  /**
   * Detect if we're on a Workday job application page (specific to Workday).
   */
  isWorkdayApplicationPage() {
    return (
      window.location.hostname.includes('myworkdayjobs.com') &&
      (
        window.location.pathname.includes('/apply') ||
        document.querySelector('[data-automation-id="applicationFormArea"]') !== null ||
        document.querySelector('[data-automation-id="formArea"]') !== null
      )
    );
  },

  /**
   * Detect if we're on a job posting page (not yet applying).
   */
  isJobPostingPage() {
    return (
      window.location.hostname.includes('myworkdayjobs.com') &&
      !window.location.pathname.includes('/apply') &&
      document.querySelector('a[data-automation-id="jobApplyButton"]') !== null
    );
  },

  /**
   * Detect whether a form field is a screening / EEO / Yes-No question rather
   * than a personal-data field. Question fields are answered via the AI
   * question prompt (with heuristic fallback) instead of plain field mapping.
   * @param {object} field - A field object from getFormFields()
   * @param {object} step  - The detected step object
   * @returns {boolean}
   */
  isQuestionField(field, step) {
    if (!field || !field.label) return false;
    const label = field.label.toLowerCase();

    if (step && (step.stepName === 'Questions' || step.stepName === 'Voluntary Disclosures')) return true;
    if (label.includes('?')) return true;
    if (this.QUESTION_KEYWORDS.test(label)) return true;

    // Yes/No radio groups are almost always questions.
    if (field.type === 'radio' && Array.isArray(field.options)) {
      const opts = field.options.map((o) => String(o).toLowerCase());
      if (opts.includes('yes') && opts.includes('no')) return true;
    }
    return false;
  },

  /**
   * Detect a sign-in / login screen on any site. The extension NEVER fills
   * credentials here (must not bypass authentication).
   */
  isLoginPage() {
    const hasPassword = !!document.querySelector(this.SELECTORS.loginPassword);
    const text = (document.body.innerText || '').toLowerCase();
    return hasPassword && /sign\s*in|log\s*in|welcome\s*back/i.test(text);
  },

  /**
   * Detect a "Create Account" / profile-creation screen on any site.
   */
  isCreateAccountPage() {
    const hasPassword = !!document.querySelector(this.SELECTORS.loginPassword);
    const text = (document.body.innerText || '').toLowerCase();
    return hasPassword && /create\s*(an?\s*)?account|register|sign\s*up/i.test(text);
  },

  /**
   * Detect the "Start Your Application" screen that offers
   * Autofill with Resume / Apply Manually / Use My Last Application.
   */
  isStartApplicationScreen() {
    const text = (document.body.innerText || '').toLowerCase();
    if (!/start\s*your\s*application|apply\s*manually|autofill\s*with\s*resume/i.test(text)) return false;
    return document.querySelectorAll('button').length > 0;
  },

  /**
   * Click "Apply Manually" on the Start Your Application screen. We fill the
   * form ourselves from stored resume data, so Workday's own resume-parsing
   * "Autofill with Resume" path is intentionally not used.
   * @returns {boolean} - true if a matching button was clicked
   */
  clickApplyManually() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('apply manually')) {
        btn.click();
        return true;
      }
    }
    return false;
  },

  /**
   * Find buttons that add a new entry in a repeatable section
   * (Work Experience / Education / Skills). Matches both automation ids and
   * visible "Add ..." text.
   * @returns {Array<HTMLElement>}
   */
  getAddButtons() {
    const buttons = document.querySelectorAll('button');
    return Array.from(buttons).filter((b) => {
      if (this.isHidden(b)) return false;
      const text = (b.textContent || '').trim();
      const autoId = (b.getAttribute('data-automation-id') || '').toLowerCase();
      return (
        autoId.includes('additem') ||
        autoId.includes('addbutton') ||
        /^add\b/i.test(text) ||
        /add\s+(an?\s+)?(work\s*experience|education|skill|entry|item|section)/i.test(text)
      );
    });
  },

  /**
   * Estimate how many entries a repeatable section currently has, by counting
   * how many visible inputs match the given label hints (one per entry).
   * @param {string[]} hints - substrings that identify an entry's field
   * @returns {number}
   */
  countSectionEntries(hints) {
    let max = 0;
    for (const hint of hints) {
      let count = 0;
      const elements = document.querySelectorAll('input, textarea, select');
      for (const el of elements) {
        if (this.isHidden(el)) continue;
        const label = this.getFieldLabel(el).toLowerCase();
        if (label.includes(hint)) count++;
      }
      max = Math.max(max, count);
    }
    return max;
  },

  /**
   * List labels of required fields that are still empty after filling.
   * @returns {Array<{label: string}>}
   */
  getEmptyRequiredFields() {
    const missing = [];
    for (const field of this.getFormFields()) {
      const el = field.element;
      if (!field.required || !el) continue;
      let value = '';
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') value = (el.value || '').trim();
      else if (el.tagName === 'SELECT') value = el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '';
      else value = (el.textContent || '').trim();
      if (!value) missing.push({ label: field.label });
    }
    return missing;
  }
};
