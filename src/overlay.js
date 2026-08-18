/**
 * overlay.js - Floating Overlay UI
 * 
 * Creates a floating panel on job-application pages using Shadow DOM
 * for complete style isolation from the host page.
 * Shows autofill status, field results, and navigation controls.
 */

const OverlayUI = {
  container: null,
  shadowRoot: null,
  panel: null,
  isExpanded: true,
  isInitialized: false,

  /**
   * Initialize the overlay UI.
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Create container with Shadow DOM for style isolation
    this.container = document.createElement('div');
    this.container.id = 'jobmate-ai-overlay';
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    // Create panel
    this.panel = document.createElement('div');
    this.panel.className = 'jm-panel';
    this.panel.innerHTML = this.getPanelHTML();
    this.shadowRoot.appendChild(this.panel);

    // Add to page
    document.body.appendChild(this.container);

    // Setup event listeners
    this.setupListeners();

    // Make draggable
    this.makeDraggable();
  },

  /**
   * Get the panel HTML template.
   */
  getPanelHTML() {
    return `
      <div class="jm-header">
        <div class="jm-brand">
          <div class="jm-logo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 3h7a5 5 0 0 1 0 10H7V3z"/>
              <path d="M7 13h8a5 5 0 0 1 0 10H7V13z"/>
            </svg>
          </div>
          <div class="jm-title">
            <span class="jm-name">JobMate AI</span>
            <span class="jm-sub">Auto Fill</span>
          </div>
        </div>
        <div class="jm-controls">
          <button class="jm-btn-icon jm-btn-minimize" title="Minimize">−</button>
          <button class="jm-btn-icon jm-btn-close" title="Close">×</button>
        </div>
      </div>
      <div class="jm-body">
        <div class="jm-status">
          <span class="jm-status-dot"></span>
          <div class="jm-status-text">Ready</div>
        </div>
        <div class="jm-results"></div>
        <div class="jm-actions"></div>
      </div>
      <div class="jm-footer">JobMate AI never auto-submits. You review every page.<br>
        <span class="jm-credit">Developed by <a href="https://linkedin.com/in/stymrj" target="_blank" rel="noopener noreferrer">Satyam Raj</a> ❤️</span>
      </div>
    `;
  },

  /**
   * Setup event listeners for panel controls.
   */
  setupListeners() {
    const minimizeBtn = this.shadowRoot.querySelector('.jm-btn-minimize');
    minimizeBtn.addEventListener('click', () => this.toggle());

    const closeBtn = this.shadowRoot.querySelector('.jm-btn-close');
    closeBtn.addEventListener('click', () => this.hide());
  },

  /**
   * Make the panel draggable by its header.
   */
  makeDraggable() {
    const header = this.shadowRoot.querySelector('.jm-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.panel.style.left = `${startLeft + dx}px`;
      this.panel.style.top = `${startTop + dy}px`;
      this.panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  },

  // --- Status methods ---

  showStatus(text, type = 'info') {
    const statusText = this.shadowRoot.querySelector('.jm-status-text');
    const statusDot = this.shadowRoot.querySelector('.jm-status-dot');
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = `jm-status-dot jm-status-${type}`;
    }
  },

  showError(text) {
    this.showStatus(text, 'error');
  },

  /**
   * Show field fill results in the panel.
   */
  showFieldResults(results) {
    const container = this.shadowRoot.querySelector('.jm-results');
    if (!container) return;

    const filled = results.filter(r => r.filled).length;
    const total = results.length;
    const pct = total ? Math.round((filled / total) * 100) : 0;

    let html = `
      <div class="jm-summary">
        <span class="jm-summary-stat"><strong>${filled}</strong>/<span>${total}</span> filled</span>
        <div class="jm-progress"><div class="jm-progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="jm-field-list">`;

    for (const result of results) {
      const icon = result.filled ? '✓' : (result.status === 'error' ? '✗' : '⚠');
      const cls = result.filled ? 'success' : (result.status === 'error' ? 'error' : 'warning');
      const conf = result.confidence ? ` (${result.confidence})` : '';

      html += `
        <div class="jm-field-item jm-field-${cls}">
          <span class="jm-field-icon">${icon}</span>
          <span class="jm-field-label">${this.escapeHtml(result.label)}</span>
          <span class="jm-field-value">${this.escapeHtml(result.value || 'Not filled')}${conf}</span>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Show the review/submit page message.
   */
  showReviewPage() {
    const container = this.shadowRoot.querySelector('.jm-results');
    if (container) {
      container.innerHTML = `
        <div class="jm-review-msg">
          <div class="jm-review-icon">📋</div>
          <p class="jm-review-title"><strong>Review Page Detected</strong></p>
          <p>Please review all your information above before submitting.</p>
          <p class="jm-warning">⚠ JobMate AI will NOT auto-submit. You must click Submit manually.</p>
        </div>`;
    }
    const actions = this.shadowRoot.querySelector('.jm-actions');
    if (actions) actions.innerHTML = '';
  },

  /**
   * Show navigation buttons (Next Page, etc.).
   */
  showNavigationButtons(showNext = true) {
    const actions = this.shadowRoot.querySelector('.jm-actions');
    if (!actions) return;

    let html = '';
    if (showNext) {
      html += '<button class="jm-btn jm-btn-next">Review & Continue →</button>';
    }
    html += '<button class="jm-btn jm-btn-refill">Re-fill This Page</button>';
    actions.innerHTML = html;

    const nextBtn = this.shadowRoot.querySelector('.jm-btn-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => navigateToNextPage());
    }
    const refillBtn = this.shadowRoot.querySelector('.jm-btn-refill');
    if (refillBtn) {
      refillBtn.addEventListener('click', () => processCurrentPage());
    }
  },

  // --- Panel visibility ---

  toggle() {
    this.isExpanded = !this.isExpanded;
    const body = this.shadowRoot.querySelector('.jm-body');
    const btn = this.shadowRoot.querySelector('.jm-btn-minimize');
    if (body) body.style.display = this.isExpanded ? 'block' : 'none';
    if (btn) btn.textContent = this.isExpanded ? '−' : '+';
  },

  expand() {
    this.isExpanded = true;
    const body = this.shadowRoot.querySelector('.jm-body');
    const btn = this.shadowRoot.querySelector('.jm-btn-minimize');
    if (body) body.style.display = 'block';
    if (btn) btn.textContent = '−';
  },

  hide() {
    if (this.container) this.container.style.display = 'none';
  },

  show() {
    if (this.container) this.container.style.display = 'block';
  },

  // --- Utilities ---

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * CSS styles for the overlay panel (Shadow DOM, fully isolated).
   */
  getStyles() {
    return `
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }

      .jm-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 360px;
        max-height: 78vh;
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16), 0 3px 10px rgba(15, 23, 42, 0.08);
        overflow: hidden;
        font-size: 13px;
        color: #0f172a;
        border: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
      }

      .jm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        color: white;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
      }

      .jm-header:active { cursor: grabbing; }

      .jm-brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .jm-logo {
        width: 30px;
        height: 30px;
        background: rgba(255, 255, 255, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        backdrop-filter: blur(4px);
      }

      .jm-title { display: flex; flex-direction: column; line-height: 1.2; }
      .jm-name { font-weight: 700; font-size: 14px; letter-spacing: 0.2px; }
      .jm-sub { font-size: 11px; opacity: 0.85; }

      .jm-controls { display: flex; gap: 6px; }

      .jm-btn-icon {
        background: rgba(255, 255, 255, 0.18);
        border: none;
        color: white;
        width: 26px;
        height: 26px;
        border-radius: 7px;
        cursor: pointer;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }

      .jm-btn-icon:hover { background: rgba(255, 255, 255, 0.32); }

      .jm-body {
        padding: 14px;
        overflow-y: auto;
        flex: 1;
        min-height: 60px;
      }

      .jm-status {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        background: #f0f9ff;
        border: 1px solid #e0f2fe;
        border-radius: 10px;
        margin-bottom: 12px;
      }

      .jm-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #3b82f6;
        margin-top: 4px;
        flex-shrink: 0;
      }

      .jm-status-dot.jm-status-success { background: #22c55e; }
      .jm-status-dot.jm-status-warning { background: #f59e0b; }
      .jm-status-dot.jm-status-error { background: #ef4444; }

      .jm-status-text {
        font-size: 12px;
        color: #334155;
        line-height: 1.45;
      }

      .jm-summary {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }

      .jm-summary-stat { font-size: 13px; color: #475569; white-space: nowrap; }
      .jm-summary-stat strong { font-size: 15px; color: #0f172a; }

      .jm-progress {
        flex: 1;
        height: 6px;
        background: #e2e8f0;
        border-radius: 99px;
        overflow: hidden;
      }

      .jm-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #4f46e5, #7c3aed);
        border-radius: 99px;
        transition: width 0.4s ease;
      }

      .jm-field-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-bottom: 8px;
      }

      .jm-field-item {
        display: grid;
        grid-template-columns: 20px 1fr 1fr;
        gap: 8px;
        padding: 7px 9px;
        border-radius: 8px;
        font-size: 12px;
        align-items: center;
      }

      .jm-field-success { background: #f0fdf4; }
      .jm-field-warning { background: #fffbeb; }
      .jm-field-error { background: #fef2f2; }

      .jm-field-icon { font-size: 13px; text-align: center; }
      .jm-field-success .jm-field-icon { color: #16a34a; }
      .jm-field-warning .jm-field-icon { color: #d97706; }
      .jm-field-error .jm-field-icon { color: #dc2626; }

      .jm-field-label {
        font-weight: 500;
        color: #334155;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .jm-field-value {
        color: #64748b;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }

      .jm-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }

      .jm-btn {
        flex: 1;
        padding: 10px 14px;
        border: none;
        border-radius: 9px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.15s;
      }

      .jm-btn-next {
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: white;
        box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
      }

      .jm-btn-next:hover { filter: brightness(1.08); }

      .jm-btn-refill {
        background: #f1f5f9;
        color: #334155;
        border: 1px solid #e2e8f0;
      }

      .jm-btn-refill:hover { background: #e2e8f0; }

      .jm-review-msg {
        padding: 16px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 10px;
        line-height: 1.6;
        text-align: center;
      }

      .jm-review-icon { font-size: 26px; margin-bottom: 6px; }
      .jm-review-title { margin-bottom: 4px; }

      .jm-review-msg p { margin: 0 0 6px 0; }

      .jm-warning {
        color: #b45309;
        font-weight: 600;
      }

      .jm-footer {
        padding: 8px 14px;
        font-size: 10.5px;
        color: #94a3b8;
        background: #f8fafc;
        border-top: 1px solid #eef2f7;
        text-align: center;
        flex-shrink: 0;
      }

      .jm-credit {
        display: block;
        margin-top: 3px;
        font-size: 9.5px;
      }

      .jm-credit a {
        color: #6366f1;
        text-decoration: none;
        font-weight: 600;
      }
    `;
  }
};