/**
 * filler.js - Form Filler Module
 * 
 * Handles DOM manipulation to fill Workday form fields.
 * Simulates real user interactions (focus, input, change, blur)
 * to satisfy the site's validation framework.
 */

const FormFiller = {

  /**
   * Fill a form field based on its type.
   * @param {object} field - Field info { element, type, label, options }
   * @param {string} value - The value to fill
   * @returns {Promise<boolean>} - True if fill was successful
   */
  async fillField(field, value) {
    if (!value || !field.element) return false;
    
    // Don't overwrite pre-filled fields that already have valid data
    if (this.hasExistingValue(field) && !field.forceOverwrite) {
      console.log(`[Filler] Skipping pre-filled field: ${field.label}`);
      return false;
    }

    try {
      switch (field.type) {
        case 'text':
        case 'email':
        case 'tel':
        case 'url':
          return await this.fillTextField(field.element, value);
        case 'textarea':
          return await this.fillTextArea(field.element, value);
        case 'dropdown':
        case 'select':
          return await this.fillDropdown(field.element, value, field);
        case 'date':
          return await this.fillDateField(field.element, value);
        case 'radio':
          return await this.fillRadioButton(field.element, value, field);
        case 'checkbox':
          return await this.fillCheckbox(field.element, value);
        case 'file':
          return await this.uploadFile(field.element, value);
        default:
          return await this.fillTextField(field.element, value);
      }
    } catch (error) {
      console.error(`[Filler] Error filling field "${field.label}":`, error);
      return false;
    }
  },

  /**
   * Check if a field already has a value.
   */
  hasExistingValue(field) {
    const el = field.element;
    if (!el) return false;

    // Split date widgets contain month/day/year option text in their
    // textContent even when empty — never treat them as pre-filled.
    if (field.type === 'date') return false;

    // Plain radio groups scanned without an ARIA container: any checked radio.
    if (field.groupRadios && field.groupRadios.length > 0) {
      return field.groupRadios.some((r) => r.checked);
    }
    // A radio input's .value attribute is a non-empty string ("on" by
    // default), so "has a value" means "is checked" for radios.
    if (el.type === 'radio' || el.getAttribute && el.getAttribute('role') === 'radio') {
      return el.checked;
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value && el.value.trim().length > 0;
    }
    if (el.tagName === 'SELECT') {
      return el.selectedIndex > 0; // 0 is usually placeholder
    }
    // Radio groups have a value only when an option is actually selected.
    if (el.getAttribute && (el.getAttribute('role') === 'radiogroup' || el.getAttribute('role') === 'radio')) {
      return !!el.querySelector('input[type="radio"]:checked, [role="radio"][aria-checked="true"]');
    }
    // For Workday custom components, check inner text
    const text = el.textContent || el.innerText || '';
    return text.trim().length > 0 && !text.includes('Select') && !text.includes('Choose');
  },

  /**
   * Simulate typing into a text input field.
   * Workday requires proper event sequence to register changes.
   */
  async fillTextField(element, value) {
    // Focus the element
    element.focus();
    element.click();
    await this.sleep(100);
    
    // Clear existing value
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await this.sleep(50);
    
    // Set the new value using native setter to bypass React/framework getters
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    
    const setter = element.tagName === 'TEXTAREA' ? nativeTextAreaValueSetter : nativeInputValueSetter;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    
    // Fire the full event sequence
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await this.sleep(50);
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    
    return true;
  },

  /**
   * Fill a textarea field (same approach as text, but might be a custom element)
   */
  async fillTextArea(element, value) {
    return this.fillTextField(element, value);
  },

  /**
   * Fill a Workday dropdown/select field.
   * Workday dropdowns are often custom divs, not native <select> elements.
   */
  async fillDropdown(element, value, field) {
    // Case 1: Native <select> element
    if (element.tagName === 'SELECT') {
      const options = Array.from(element.options);
      const match = options.find(opt => 
        opt.text.toLowerCase().includes(value.toLowerCase()) ||
        opt.value.toLowerCase().includes(value.toLowerCase())
      );
      if (match) {
        element.value = match.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    // Case 2: Workday custom dropdown
    // Click to open the dropdown
    element.click();
    await this.sleep(300);

    // Look for the dropdown list that appeared
    const dropdownList = document.querySelector(
      '[data-automation-id="dropdownList"], ' +
      '[role="listbox"], ' +
      '.css-dropdownList, ' +
      '[data-automation-id="selectWidget"] [role="listbox"]'
    );

    if (dropdownList) {
      // Find matching option in the list
      const listItems = dropdownList.querySelectorAll(
        '[role="option"], [data-automation-id="promptOption"], li'
      );
      
      const normalizedValue = value.toLowerCase().trim();
      let bestMatch = null;
      
      for (const item of listItems) {
        const itemText = (item.textContent || item.innerText || '').toLowerCase().trim();
        if (itemText === normalizedValue || itemText.includes(normalizedValue)) {
          bestMatch = item;
          break;
        }
      }

      if (bestMatch) {
        bestMatch.click();
        await this.sleep(200);
        return true;
      }
    }

    // Case 3: Searchable dropdown (type to filter)
    const searchInput = element.querySelector('input') || 
                       element.closest('[data-automation-id]')?.querySelector('input');
    if (searchInput) {
      await this.fillTextField(searchInput, value);
      await this.sleep(500);
      // Click the first matching result
      const firstResult = document.querySelector(
        '[role="option"]:first-child, [data-automation-id="promptOption"]:first-child'
      );
      if (firstResult) {
        firstResult.click();
        await this.sleep(200);
        return true;
      }
    }

    return false;
  },

  /**
   * Fill a date field. Workday date fields are usually custom widgets made of
   * separate Month / Day / Year sub-controls (each a select or input). When
   * detected, each part is filled individually; otherwise fall back to a plain
   * text/date input.
   */
  async fillDateField(element, dateStr) {
    if (!dateStr) return false;

    const partSel = '[data-automation-id*="dateSectionMonth"], [data-automation-id*="dateSectionDay"], [data-automation-id*="dateSectionYear"]';

    // Walk up to the widget wrapper that actually contains the Month / Day /
    // Year sub-controls. The scanned element may be one of the parts itself
    // (its own data-automation-id contains "date"), or the wrapper, or an
    // unrelated ancestor.
    let container = element;
    for (let i = 0; i < 4 && container; i++) {
      if (container.querySelectorAll(partSel).length >= 2) break;
      container = container.parentElement;
    }
    if (!container || container.querySelectorAll(partSel).length < 2) {
      container = element.closest('[data-automation-id*="date"], [data-automation-id*="Date"]') || element;
    }

    const monthEl = container.querySelector('[data-automation-id*="dateSectionMonth"]');
    const dayEl = container.querySelector('[data-automation-id*="dateSectionDay"]');
    const yearEl = container.querySelector('[data-automation-id*="dateSectionYear"]');

    if ((monthEl || yearEl) && (monthEl || yearEl) !== container) {
      const { month, day, year } = this.parseDate(dateStr);
      let filled = false;
      if (monthEl && month) filled = await this.fillDatePart(monthEl, month) || filled;
      if (dayEl && day) filled = await this.fillDatePart(dayEl, day) || filled;
      if (yearEl && year) filled = await this.fillDatePart(yearEl, year) || filled;
      return filled;
    }

    // Plain date / text input fallback. Native date/month inputs need the ISO
    // format (YYYY-MM-DD), so convert resume formats before filling.
    const dateInput = element.querySelector('input') || element;
    if ((dateInput.type === 'date' || dateInput.type === 'month') && !/^\d{4}-\d{2}/.test(dateStr)) {
      const { month, day, year } = this.parseDate(dateStr);
      const iso = [year, month, day || '01'].filter(Boolean).join('-');
      if (year) return this.fillTextField(dateInput, iso);
    }
    return this.fillTextField(dateInput, dateStr);
  },

  /**
   * Parse dates in common resume formats: MM/YYYY, MM/DD/YYYY, YYYY-MM-DD,
   * or "January 2019" / "Present" (returns nulls for missing parts).
   */
  parseDate(str) {
    const text = String(str).trim();
    if (/present|current|now/i.test(text)) return { month: null, day: null, year: null };

    let m = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/); // MM/DD/YYYY
    if (m) return { month: m[1], day: m[2], year: this.normalizeYear(m[3]) };

    m = text.match(/(\d{1,2})\s*\/\s*(\d{2,4})/); // MM/YYYY
    if (m) return { month: m[1], day: null, year: this.normalizeYear(m[2]) };

    m = text.match(/(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/); // YYYY-MM(-DD)
    if (m) return { month: m[2], day: m[3] || null, year: m[1] };

    m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{2,4})/i);
    if (m) {
      const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      return { month: months[m[1].slice(0, 3).toLowerCase()], day: null, year: this.normalizeYear(m[2]) };
    }

    return { month: null, day: null, year: null };
  },

  normalizeYear(year) {
    const y = String(year);
    return y.length === 2 ? (parseInt(y, 10) > 40 ? `19${y}` : `20${y}`) : y;
  },

  /**
   * Fill one Month/Day/Year part, which may be a <select> or an <input>.
   */
  async fillDatePart(el, value) {
    if (!el) return false;
    const target = String(value).trim();

    if (el.tagName === 'SELECT') {
      // Match by exact text/value, then by numeric value (handles "January" vs "01").
      let opt = Array.from(el.options).find(
        (o) => o.text.trim() === target || o.value === target
      );
      if (!opt) {
        const num = parseInt(target, 10);
        if (!isNaN(num)) {
          opt = Array.from(el.options).find((o) => parseInt(o.value, 10) === num || parseInt(o.text, 10) === num);
        }
      }
      if (opt) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    return this.fillTextField(el, value);
  },

  /**
   * Select a radio button option.
   */
  async fillRadioButton(element, value, field) {
    // Plain radio groups carry the full radio list on the field itself.
    let options;
    if (field && field.groupRadios && field.groupRadios.length > 0) {
      options = field.groupRadios;
    } else if (element && element.querySelectorAll) {
      const radioGroup = element.closest('[role="radiogroup"]') || element;
      options = radioGroup.querySelectorAll(
        '[role="radio"], input[type="radio"], [data-automation-id*="radio"]'
      );
    } else {
      return false;
    }

    const normalizedValue = value.toLowerCase().trim();
    
    for (const option of options) {
      const label = this.getElementLabel(option).toLowerCase();
      if (label.includes(normalizedValue) || normalizedValue.includes(label)) {
        option.click();
        await this.sleep(100);
        return true;
      }
    }

    return false;
  },

  /**
   * Toggle a checkbox.
   */
  async fillCheckbox(element, shouldCheck) {
    const isChecked = element.getAttribute('aria-checked') === 'true' || element.checked;
    const wantChecked = shouldCheck === true || shouldCheck === 'true' || shouldCheck === 'Yes';
    
    if (isChecked !== wantChecked) {
      element.click();
      await this.sleep(100);
    }
    return true;
  },

  /**
   * Trigger file upload on a file input.
   * Note: The actual resume file is passed as a File object.
   */
  async uploadFile(element, file) {
    // Find the actual file input
    const fileInput = element.querySelector('input[type="file"]') || element;
    
    if (fileInput.type !== 'file') {
      console.warn('[Filler] Could not find file input element');
      return false;
    }

    // Create a DataTransfer to set files on the input
    const dataTransfer = new DataTransfer();
    if (file instanceof File) {
      dataTransfer.items.add(file);
    }
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await this.sleep(500);
    return true;
  },

  /**
   * Get the label text associated with an element.
   */
  getElementLabel(element) {
    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    
    // Check associated label
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent.trim();
    }
    
    // Check parent/sibling text
    const parent = element.parentElement;
    if (parent) {
      // Options are usually wrapped in a <label> whose text is the option text.
      if (parent.tagName === 'LABEL') return parent.textContent.trim();
      const labelEl = parent.querySelector('label');
      if (labelEl) return labelEl.textContent.trim();
    }
    // Fall back to the value attribute (radio/option inputs).
    const valueAttr = element.getAttribute && element.getAttribute('value');
    if (valueAttr) return valueAttr;
    
    return element.textContent?.trim() || '';
  },

  /**
   * Utility: sleep for a given number of milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
