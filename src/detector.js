/**
 * detector.js - Lightweight form detector (runs on <all_urls>)
 *
 * This is the ONLY content script declared statically in the manifest, so the
 * heavy autofill engine (PDF.js, Mammoth, mappers, fillers...) is never loaded
 * on unrelated pages. When this script detects a job-application form on the
 * page it dynamically injects the full engine via chrome.scripting, then
 * re-checks on SPA navigation / DOM growth.
 *
 * The detector is intentionally small and side-effect free.
 */
(function () {
  'use strict';

  if (window.__jobmateDetectorInstalled) return;
  window.__jobmateDetectorInstalled = true;

  const ENGINE_FILES = [
    'src/parser.js',
    'src/ai-service.js',
    'src/mapper.js',
    'src/filler.js',
    'src/navigator.js',
    'src/overlay.js',
    'src/content.js'
  ];

  let injected = false;
  let injecting = false;
  let lastCheckedUrl = '';

  // Words that mark a page as job-application related. Cheap and noisy on
  // purpose; the full engine still gates on FormNavigator.isFillableFormPage().
  const PAGE_KEYWORDS = /(apply|application|career|candidat|job|position|resume|cv|hiring|recruit|workday|greenhouse|lever|bamboo|jobvite|smartrecruiters|myworkdayjobs|icims|jobright|pando|taleo|jobscore|hire|vacancy|role\b)/i;
  const PATH_KEYWORDS = /(apply|application|career|job|position|resume|hiring|candidate)/i;

  function isJobishUrl() {
    const path = (window.location.pathname + ' ' + window.location.search).toLowerCase();
    return PATH_KEYWORDS.test(path);
  }

  function countVisibleFields() {
    let count = 0;
    try {
      const els = document.querySelectorAll('input, select, textarea');
      for (const el of els) {
        if (el.disabled || el.readOnly) continue;
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (!rect || rect.width === 0 || rect.height === 0) continue;
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        count++;
        if (count >= 3) break;
      }
    } catch (e) {
      /* ignore */
    }
    return count;
  }

  function pageMentionsJobs() {
    if (isJobishUrl()) return true;
    const title = (document.title || '').slice(0, 200);
    const head = (document.head && document.head.innerText || '').slice(0, 3000);
    return PAGE_KEYWORDS.test(title) || PAGE_KEYWORDS.test(head);
  }

  function qualifies() {
    if (!document.body) return false;
    if (countVisibleFields() < 3) return false;
    return pageMentionsJobs();
  }

  function injectEngine() {
    if (injected || injecting) return;
    injecting = true;
    try {
      // Ask the background worker to inject the engine into this tab via
      // chrome.scripting (keeps everything in the content-script world).
      chrome.runtime.sendMessage({ type: 'INJECT_JOBMATE' }, (resp) => {
        injecting = false;
        if (chrome.runtime.lastError || (resp && resp.error)) {
          // Rare: injection failed (e.g. privileged page). Never retry-loop.
          injected = true;
          return;
        }
        injected = !!resp.result;
      });
    } catch (e) {
      injecting = false;
      injected = true;
    }
  }

  function check() {
    const url = window.location.href;
    if (url === lastCheckedUrl && injected) return;
    lastCheckedUrl = url;

    if (qualifies()) {
      injectEngine();
    }
  }

  // Initial check once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }

  // SPA navigation support: history changes.
  window.addEventListener('popstate', () => setTimeout(check, 600));
  if (window.history && window.history.pushState) {
    const wrap = (type) => {
      const orig = window.history[type];
      window.history[type] = function (...args) {
        const r = orig.apply(this, args);
        setTimeout(check, 600);
        return r;
      };
    };
    wrap('pushState');
    wrap('replaceState');
  }

  // Dynamic form detection: watch for meaningful DOM growth (SPA page loads,
  // modals, iframe-less tabbed forms). Debounced + capped.
  let observer = null;
  let debounceTimer = null;
  function scheduleCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, 900);
  }
  try {
    observer = new MutationObserver(() => {
      if (!injected) scheduleCheck();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });
  } catch (e) {
    /* ignore */
  }

  // Also allow the popup / background to force a re-check.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'JOBMATE_RECHECK') {
      lastCheckedUrl = '';
      injected = false;
      check();
      sendResponse({ ok: true });
    }
  });
})();
