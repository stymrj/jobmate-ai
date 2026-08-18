# JobMate AI - Auto Fill Application form

A Chrome extension (Manifest V3) that automatically fills **job application
forms on any career site** — Workday, Greenhouse, Lever, SmartRecruiters, and
plain HTML career pages — using resume data parsed by the AI provider of your
choice (OpenAI, Google Gemini, DeepSeek, or Anthropic Claude). It targets
multi-step applications and fills personal info, work experience, education,
dates, Yes/No screening questions and EEO disclosures —
**without ever submitting the application for you.**

## Features

- **Works on any job application site.** A lightweight detector script watches
  every page and loads the full engine only when it finds a job-application
  form (Workday automation-ids, generic `<form>` + job copy, or an apply URL).
- **Resume parsing (AI)** — upload a PDF/DOCX; your chosen AI provider
  (OpenAI / Gemini / DeepSeek / Claude, picked in Settings with its own
  model) extracts a structured JSON resume (`firstName`, `email`,
  `workExperience[]`, `education[]`, skills, …).
- **Multi-step form filling** — detects the current step, fills each page, and
  offers a **"Review & Continue"** button so you confirm every page.
- **AI + heuristic mapping** — field labels are matched with a fast heuristic
  dictionary first; unrecognized fields fall back to the configured AI.
  Works fully heuristically when no API key is set.
- **Mapping cache (saves AI costs)** — every confirmed value is saved per
  site + field label. Repeat applications (or later pages of the same
  application) reuse it **without calling the AI again**; corrections you make
  before "Review & Continue" are learned too. The cache resets when you
  upload a new resume.
- **Screening / EEO / Yes-No questions** — answered via a dedicated AI question
  prompt with conservative heuristics (authorization, sponsorship, relocation).
  EEO questions default to "Decline to self-identify" and are never fabricated.
- **Repeatable sections** — adds Work Experience / Education rows to match your
  resume entries and fills them sequentially.
- **Split date widgets** (Workday Month/Day/Year) and native `date` inputs.
- **Resume file auto-upload** — attaches the stored PDF/DOCX to Resume/CV fields.
- **Validation** — flags required fields left empty and asks you to confirm.
- **Optional admin analytics** — anonymously track installs, autofills and top
  sites on your own server (see `admin/`). Off by default.
- **Safety by design** — never fills sign-in credentials, never auto-submits,
  and keeps all data local to your browser + your chosen AI provider's API.

## Installation (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension. Open the popup and use **Settings** to pick your **AI
   provider** (OpenAI, Gemini, DeepSeek, or Claude).
5. API key handling — in order of precedence:
   - **Your own key** in Settings always wins and stays in your browser.
   - Otherwise a **shared key provided by the admin** is used automatically
     (the extension ships with one and re-fetches rotations from the admin
     server, see `admin/README.md`).
   - If neither is set, the extension runs in heuristic-only mode.

## Usage

1. **Upload your resume** in the popup (PDF or DOCX). JobMate AI parses it
   with your configured AI provider and stores the structured data + the
   original file.
2. **Open any job application** — Workday, Greenhouse, Lever, or a generic
   career-site form. A small panel appears only on pages the extension can
   fill.
3. Click **Start Autofill** in the popup (or use the panel).
4. Review each page. Missing/uncertain fields are shown with a ⚠; required
   empty fields are called out. Fix what you need, then click
   **Review & Continue**.
5. On the final Review page the extension **stops** — you click **Submit**
   yourself, after a final human check.

## Publishing to the Chrome Web Store

1. `npm test` — run the test suites.
2. Package the folder as a ZIP (exclude `node_modules/`, `admin/data/`, and
   `test/` — they are not needed by the extension).
3. Prepare the store listing:
   - **Description**: explain that `<all_urls>` is used to auto-fill job
     application forms on any career site, and that AI features are optional
     (user-provided API key for OpenAI, Gemini, DeepSeek, or Claude).
   - **Screenshots**: popup, autofill panel on a real application page.
4. Store review checklist already handled in code:
   - No inline scripts in extension pages (MV3 CSP compliant).
   - No remote code / remote fonts.
   - `connect-src` restricted to `api.openai.com`, `api.deepseek.com`,
     `generativelanguage.googleapis.com`, `api.anthropic.com`, localhost, and
     `*.jobmate-ai.com` (add your analytics domain here if you use a
     different one).
   - Analytics is **opt-in** and anonymous.

## Project layout

```
manifest.json     MV3 manifest (lightweight detector on <all_urls>)
src/detector.js   Lightweight form detector; injects the engine on demand
src/parser.js     PDF/DOCX → raw text
src/ai-service.js AI passthrough (parse, map field, answer question)
src/mapper.js     Heuristic field-label dictionary + AI fallback
src/navigator.js  Form/step/login detection, field scanning, navigation
src/filler.js     DOM filling (text, dropdowns, dates, radios, files)
src/overlay.js    Floating panel UI (status, results, navigation)
src/content.js    Orchestrator: page processing pipeline
src/background.js Background worker: storage, AI provider proxy (OpenAI /
                  Gemini / DeepSeek / Claude), injection, analytics batching
popup/            Extension popup (upload, settings, preview, autofill)
admin/            Zero-dependency admin/analytics server + dashboard
test/             jsdom test suites (npm test)
docs/             Design and limitation notes
```

## Development

```bash
npm install        # installs jsdom (dev-only; not shipped)
npm test           # runs all test suites
```

## Admin panel

```bash
cd admin
ADMIN_TOKEN=change-me npm start   # dashboard at http://localhost:8787
```

See [admin/README.md](admin/README.md) for details on event ingestion,
production setup, and the dashboard.

## Security notes

- Your API key is stored in `chrome.storage.local` and only used to call the
  AI provider you selected (OpenAI, Gemini, DeepSeek, or Claude). Never commit
  a real key to the repository.
- No credentials are ever filled. Sign-in / Create-Account screens are detected
  and left for you to complete manually.
- The extension never clicks the final submit button.
- Analytics (off by default) sends only an anonymous random ID, event names,
  and site hostnames to the endpoint you configure.
