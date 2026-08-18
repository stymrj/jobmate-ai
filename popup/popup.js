/**
 * popup.js - Extension Popup Controller
 * 
 * Handles resume upload, parsing, settings, and autofill trigger.
 */

console.log('[JobMateAI] popup.js loaded');

let selectedFile = null;

// ============================================================
// INITIALIZATION
// ============================================================

function initializePopup() {
  console.log('[Popup] Initializing popup UI');
  
  // Setup tabs
  setupTabs();
  
  // Setup file upload
  setupFileUpload();
  
  // Setup settings
  setupSettings();
  
  // Setup autofill trigger
  setupAutofill();
  
  // Setup resume preview tab
  setupPreview();
  
  // Reflect already-saved resume state, if any
  loadSavedState();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  initializePopup();
}

// ============================================================
// TAB NAVIGATION
// ============================================================

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  console.log('[Popup] Found', tabs.length, 'tabs');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      console.log('[Popup] Tab clicked:', tabName);
      
      // Hide all tabs and deactivate buttons
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      
      // Activate clicked tab
      this.classList.add('active');
      const content = document.getElementById(`tab-${tabName}`);
      if (content) {
        content.classList.add('active');
      } else {
        console.error('[Popup] Tab content not found:', `tab-${tabName}`);
      }
    });
  });
}

// ============================================================
// FILE UPLOAD
// ============================================================

function setupFileUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const parseBtn = document.getElementById('parseBtn');
  const removeBtn = document.getElementById('removeFile');
  
  if (!dropZone || !fileInput || !parseBtn) {
    console.error('[Popup] Upload elements missing', { dropZone, fileInput, parseBtn });
    return;
  }
  
  console.log('[Popup] Setting up file upload');
  
  // Click to browse
  dropZone.addEventListener('click', () => {
    console.log('[Popup] Drop zone clicked');
    fileInput.click();
  });
  
  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.background = '#e3f2fd';
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.background = '#f9f9f9';
  });
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.background = '#f9f9f9';
    if (e.dataTransfer.files.length > 0) {
      console.log('[Popup] File dropped');
      handleFile(e.dataTransfer.files[0]);
    }
  });
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      console.log('[Popup] File selected via browse');
      handleFile(e.target.files[0]);
    }
  });
  
  parseBtn.addEventListener('click', parseResume);
  
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      console.log('[Popup] Removing file');
      selectedFile = null;
      document.getElementById('fileInfo').style.display = 'none';
      dropZone.style.display = 'block';
      parseBtn.disabled = true;
      fileInput.value = '';
      const autofillBtn = document.getElementById('autofillBtn');
      if (autofillBtn) autofillBtn.disabled = true;
    });
  }
}

/**
 * Wire up the "Start Autofill on Page" button.
 */
function setupAutofill() {
  const autofillBtn = document.getElementById('autofillBtn');
  if (!autofillBtn) {
    console.error('[Popup] Autofill button missing');
    return;
  }

  autofillBtn.addEventListener('click', async () => {
    autofillBtn.disabled = true;
    const originalText = autofillBtn.textContent;
    autofillBtn.textContent = 'Starting autofill...';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'START_AUTOFILL' });
      if (resp && resp.error) throw new Error(resp.error);
      autofillBtn.textContent = 'Autofill started — check the page.';
      setTimeout(() => window.close(), 1000);
    } catch (error) {
      console.error('[Popup] Autofill error:', error);
      autofillBtn.textContent = originalText;
      autofillBtn.disabled = false;
      alert('Autofill error: ' + error.message);
    }
  });
}

/**
 * If a resume is already saved, show it and enable autofill directly so the
 * user does not have to re-upload. Also warns when no OpenAI API key is set.
 */
async function loadSavedState() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    const status = resp && resp.result;

    if (status && !status.hasApiKey) {
      showNoApiKeyWarning();
    }

    if (!status || !status.hasResume) return;

    const autofillBtn = document.getElementById('autofillBtn');
    const parseBtn = document.getElementById('parseBtn');
    const dropZone = document.getElementById('dropZone');
    const fileInfo = document.getElementById('fileInfo');
    const nameEl = document.getElementById('fileName');
    const sizeEl = document.getElementById('fileSize');

    if (autofillBtn) autofillBtn.disabled = false;
    if (parseBtn) parseBtn.disabled = true;
    if (dropZone) dropZone.style.display = 'none';
    if (nameEl) nameEl.textContent = status.resumeName || 'Saved resume';
    if (sizeEl) sizeEl.textContent = 'Resume already parsed';
    if (fileInfo) fileInfo.style.display = 'block';
  } catch (e) {
    console.log('[Popup] Could not load saved resume state:', e.message);
  }
}

/**
 * Warn the user that AI features need an API key (set in Settings).
 * Without a key the extension still fills fields heuristically.
 */
function showNoApiKeyWarning() {
  const fileInfo = document.getElementById('fileInfo');
  const parseStatus = document.getElementById('parseStatus');
  if (fileInfo && parseStatus) {
    const sizeEl = document.getElementById('fileSize');
    if (sizeEl) sizeEl.textContent = '';
    const nameEl = document.getElementById('fileName');
    if (nameEl) nameEl.textContent = '⚠ No AI API key set';
  }
  const parseBtn = document.getElementById('parseBtn');
  if (parseBtn) {
    parseBtn.disabled = true;
    parseBtn.textContent = 'Set an API key in Settings to parse with AI';
  }
  const status = document.getElementById('saveStatus');
  if (status) status.textContent = 'Set your AI API key in the Settings tab to enable AI parsing.';
}

function handleFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) {
    alert('Please upload PDF or DOCX only');
    return;
  }
  
  console.log('[Popup] File selected:', file.name);
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);
  document.getElementById('fileInfo').style.display = 'block';
  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('parseBtn').disabled = false;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function parseResume() {
  if (!selectedFile) {
    console.error('[Popup] No file selected');
    return;
  }
  
  const parseBtn = document.getElementById('parseBtn');
  const parseStatus = document.getElementById('parseStatus');
  const parseStatusText = document.getElementById('parseStatusText');
  
  parseBtn.disabled = true;
  parseStatus.style.display = 'block';
  parseStatus.classList.remove('success', 'error');
  parseStatusText.textContent = 'Reading file...';
  const startTime = Date.now();
  
  try {
    const arrayBuffer = await readFile(selectedFile);
    // Convert to base64 BEFORE handing the buffer to the parser: pdf.js
    // transfers (detaches) the ArrayBuffer to its worker thread, which would
    // make the buffer unusable afterwards ("Cannot perform Construct on a
    // detached ArrayBuffer").
    const base64 = arrayBufferToBase64(arrayBuffer);
    parseStatusText.textContent = 'Extracting text...';
    
    const rawText = await extractText(selectedFile, arrayBuffer);
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No text found in resume');
    }
    
    console.log('[Popup] Resume text extracted:', rawText.length, 'chars');
    parseStatusText.textContent = 'Sending to AI...';
    
    const result = await chrome.runtime.sendMessage({
      type: 'AI_REQUEST',
      action: 'STRUCTURE_RESUME',
      data: { rawText }
    });
    
    console.log('[Popup] AI result:', result);
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    await chrome.runtime.sendMessage({
      type: 'SAVE_RESUME',
      data: {
        data: result.result,
        file: {
          name: selectedFile.name,
          type: selectedFile.type || '',
          base64
        }
      }
    });
    
    parseStatusText.textContent = `✓ Resume parsed! (${((Date.now() - startTime) / 1000).toFixed(1)}s)`;
    parseStatus.classList.add('success');
    document.getElementById('autofillBtn').disabled = false;
    
  } catch (error) {
    console.error('[Popup] Parse error:', error);
    parseStatusText.textContent = '✗ ' + error.message;
    parseStatus.classList.add('error');
    parseBtn.disabled = false;
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Convert an ArrayBuffer to a base64 string (chunked to avoid stack overflow
 * on larger files). Used to persist the resume file so it can be re-attached
 * to Resume/CV upload fields on the application page.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractText(file, arrayBuffer) {
  const ext = file.name.split('.').pop().toLowerCase();
  
  if (ext === 'pdf') {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  }
  
  if (ext === 'docx') {
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth.js library not loaded');
    }
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  
  throw new Error('Unsupported file format. Use PDF or DOCX.');
}

// ============================================================
// PREVIEW TAB
// ============================================================

/**
 * Load the parsed resume and render it in the Preview tab.
 */
async function setupPreview() {
  const empty = document.getElementById('previewEmpty');
  const dataEl = document.getElementById('previewData');
  if (!empty || !dataEl) return;

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_RESUME' });
    const data = resp && resp.result;
    if (!data) return;
    empty.style.display = 'none';
    dataEl.style.display = 'block';
    dataEl.innerHTML = renderPreview(data);
  } catch (e) {
    console.log('[Popup] Preview load skipped:', e.message);
  }
}

function renderPreview(data) {
  const esc = (v) => {
    const div = document.createElement('div');
    div.textContent = v == null ? '' : String(v);
    return div.innerHTML;
  };
  let html = '';

  // Contact
  html += `<div class="preview-section"><h3>Contact</h3><div class="preview-grid">`;
  html += field('Name', [data.firstName, data.lastName].filter(Boolean).join(' '));
  html += field('Email', data.email);
  html += field('Phone', data.phone);
  const loc = data.location ? [data.location.address, data.location.city, data.location.state, data.location.country, data.location.zip].filter(Boolean).join(', ') : '';
  html += field('Location', loc);
  html += field('LinkedIn', data.linkedin);
  html += field('GitHub', data.github);
  html += field('Portfolio', data.portfolio);
  html += field('Summary', data.summary);
  html += field('Years of Experience', data.yearsOfExperience);
  html += `</div></div>`;

  // Work experience
  if (Array.isArray(data.workExperience) && data.workExperience.length) {
    html += `<div class="preview-section"><h3>Work Experience</h3>`;
    for (const job of data.workExperience) {
      const dates = [job.startDate, job.endDate].filter(Boolean).join(' – ');
      html += `<div class="preview-card"><strong>${esc(job.title)}</strong> — ${esc(job.company)}<br>` +
        `<span style="color:#64748b;font-size:12px;">${esc(job.location)}${dates ? ' · ' + esc(dates) : ''}</span>` +
        `<div class="preview-desc">${esc(job.description)}</div></div>`;
    }
    html += `</div>`;
  }

  // Education
  if (Array.isArray(data.education) && data.education.length) {
    html += `<div class="preview-section"><h3>Education</h3>`;
    for (const edu of data.education) {
      const dates = [edu.startDate, edu.endDate].filter(Boolean).join(' – ');
      html += `<div class="preview-card"><strong>${esc(edu.degree)}</strong> — ${esc(edu.school)}<br>` +
        `<span style="color:#64748b;font-size:12px;">${esc(edu.field)}${edu.gpa ? ' · GPA ' + esc(edu.gpa) : ''}${dates ? ' · ' + esc(dates) : ''}</span></div>`;
    }
    html += `</div>`;
  }

  // Skills
  if (Array.isArray(data.skills) && data.skills.length) {
    html += `<div class="preview-section"><h3>Skills</h3><div class="preview-skills">` +
      data.skills.map((s) => `<span class="skill-tag">${esc(s)}</span>`).join('') +
      `</div></div>`;
  }

  // Languages
  if (Array.isArray(data.languages) && data.languages.length) {
    html += `<div class="preview-section"><h3>Languages</h3><div class="preview-skills">` +
      data.languages.map((l) => `<span class="skill-tag">${esc(l)}</span>`).join('') +
      `</div></div>`;
  }

  return html;

  function field(label, value) {
    if (!value) return '';
    return `<div class="preview-field"><span class="preview-label">${esc(label)}</span><span class="preview-value">${esc(value)}</span></div>`;
  }
}

// ============================================================
// SETTINGS
// ============================================================

function setupSettings() {
  const saveBtn = document.getElementById('saveSettings');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const providerSelect = document.getElementById('aiProvider');
  const modelInput = document.getElementById('aiModel');
  const modelPresets = document.getElementById('modelPresets');
  const apiKeyLabel = document.getElementById('apiKeyLabel');
  const apiKeyHint = document.getElementById('apiKeyHint');
  const providerHint = document.getElementById('providerHint');
  const analyticsEndpoint = document.getElementById('analyticsEndpoint');
  const analyticsEnabled = document.getElementById('analyticsEnabled');
  const userIdEl = document.getElementById('userId');

  if (toggleKeyBtn && apiKeyInput) {
    toggleKeyBtn.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (!saveBtn) {
    console.error('[Popup] Settings elements missing');
    return;
  }

  // Provider catalog comes from the background (single source of truth).
  chrome.runtime.sendMessage({ type: 'GET_PROVIDERS' })
    .then((resp) => {
      const providers = (resp && resp.result) || [];
      if (!providers.length) return;
      providerSelect.innerHTML = providers
        .map((p) => `<option value="${p.id}">${p.label}</option>`)
        .join('');
      providersById = Object.fromEntries(providers.map((p) => [p.id, p]));
      applyProviderUI();
    })
    .catch((e) => console.log('[Popup] Provider catalog load skipped:', e.message));

  function applyProviderUI() {
    const id = providerSelect.value;
    const p = providersById[id];
    if (!p) return;
    if (modelPresets) modelPresets.textContent = p.models.join(', ');
    if (apiKeyLabel) apiKeyLabel.textContent = `${p.label} API Key`;
    if (apiKeyInput) apiKeyInput.placeholder = p.keyPlaceholder;
    if (providerHint) {
      providerHint.textContent =
        id === 'openai'
          ? 'OpenAI: get a key at platform.openai.com.'
          : id === 'gemini'
            ? 'Google Gemini: get a free key at aistudio.google.com.'
            : id === 'deepseek'
              ? 'DeepSeek: get a key at platform.deepseek.com.'
              : 'Anthropic Claude: get a key at console.anthropic.com.';
    }
    if (apiKeyHint) {
      apiKeyHint.textContent = id === 'claude'
        ? 'Keys start with sk-ant-. Optional but recommended — without a key, fields are filled heuristically.'
        : 'Optional but recommended. Without a key, JobMate AI fills fields heuristically. Your key stays in your browser.';
    }
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', applyProviderUI);
  }

  saveBtn.addEventListener('click', async () => {
    const data = {};
    if (apiKeyInput) data.apiKey = apiKeyInput.value.trim();
    if (providerSelect) data.aiProvider = providerSelect.value;
    if (modelInput) data.aiModel = modelInput.value.trim();
    if (analyticsEndpoint) data.analyticsEndpoint = analyticsEndpoint.value.trim();
    if (analyticsEnabled) data.analyticsEnabled = analyticsEnabled.checked;
    try {
      console.log('[Popup] Saving settings');
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data });
      const status = document.getElementById('saveStatus');
      if (status) {
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 2000);
      }
    } catch (error) {
      console.error('[Popup] Settings save error:', error);
      alert('Error: ' + error.message);
    }
  });

  // Load settings
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
    .then(response => {
      const settings = response && response.result;
      if (!settings) return;
      if (providerSelect && settings.aiProvider) providerSelect.value = settings.aiProvider;
      if (modelInput && settings.aiModel) modelInput.value = settings.aiModel;
      if (apiKeyInput && settings.apiKey) apiKeyInput.value = settings.apiKey;
      if (settings.analyticsEndpoint && analyticsEndpoint) {
        analyticsEndpoint.value = settings.analyticsEndpoint;
      }
      if (analyticsEnabled) analyticsEnabled.checked = !!settings.analyticsEnabled;
      applyProviderUI();
    })
    .catch(e => console.log('[Popup] Settings load skipped:', e.message));

  // Tell the user whether the shared admin key is active (no own key set).
  chrome.runtime.sendMessage({ type: 'GET_STATUS' })
    .then(resp => {
      const status = resp && resp.result;
      if (apiKeyHint && status && status.keySource === 'admin' && !(apiKeyInput && apiKeyInput.value.trim())) {
        apiKeyHint.textContent =
          `A shared ${(providersById[status.adminProvider] || {}).label || 'AI'} key provided by the admin is currently in use. ` +
          'Set your own key above to override it.';
        apiKeyHint.style.color = '#059669';
      }
    })
    .catch(() => {});

  // Show the anonymous user id (for matching users in the admin panel)
  chrome.runtime.sendMessage({ type: 'GET_STATUS' })
    .then(resp => {
      const status = resp && resp.result;
      if (userIdEl && status && status.userId) {
        userIdEl.textContent = status.userId.slice(0, 8) + '…';
        userIdEl.title = status.userId;
      }
    })
    .catch(() => {});
}

let providersById = {};
