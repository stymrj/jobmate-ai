# Known Limitations

Honest list of what JobMate AI can and cannot do, and what still requires a
human on real job application forms.

## General

- **Not a complete bot.** The extension fills one page at a time and stops on
  the Review page. It does not auto-submit, does not click through captchas or
  other anti-bot challenges, and does not handle every ATS variation.
- **Workday DOMs differ across tenants.** Workday shells the same components
  with different `data-automation-id`s and markup (NVIDIA, Target, Workday
  itself, banks, universities…). Detection is heuristic; a page that doesn't
  match the common patterns may not be filled.
- **Generic sites vary.** The detector looks for a form + job-application
  signals (URL or page copy). A career page that hides its form in an iframe,
  or renders it fully client-side after long delays, may not be detected.
- **Dynamic fields.** Some fields load options only after focus or typing. If
  an option list isn't rendered yet, the fill may be skipped and reported as ⚠.
- **Multi-select / searchable dropdowns.** The filler covers native `<select>`
  and listbox-style dropdowns; some tag/multi-select widgets may not fill.

## AI behavior

- **Requires an API key for one of the supported providers** (OpenAI, Google
  Gemini, DeepSeek, or Anthropic Claude — chosen in popup Settings) for
  parsing and AI mapping. Without a key the extension still runs in
  **heuristic-only** mode (fills personal info, experience/education, Yes/No
  questions from resume booleans) but cannot parse a new resume or answer
  free-text questions well.
- **Parsing quality depends on the resume format and provider.** Text-heavy
  resumes parse well; heavily stylized/table-based PDFs may produce messy
  `workExperience` arrays that need manual review. Smaller/free models may
  produce lower-quality structured output than paid ones.
- **Claude has no strict JSON mode.** JSON is requested via the system prompt;
  the response is still JSON-parsed and errors are surfaced if the model
  returns prose.
- **The mapping cache can reuse stale values.** Cached answers are cleared
  whenever you upload a new resume, and they are only reused when they fit
  the widget's own options (for dropdowns/radios) — but a value learned on a
  site that changes its questions may be wrong there. Verify before
  continuing.
- **Confidence is not truth.** Every AI answer is shown with a confidence
  level; always verify before continuing.

## Questions & EEO

- **Conservativeness by design.** Gender/race/veteran/disability questions are
  left as "Decline to self-identify" or unanswered rather than guessed.
- **"Other/free-text" screening questions** (e.g. "Why do you want to work
  here?") are not auto-answered unless the resume clearly contains the info.

## Repeatable sections

- The extension adds rows to match the resume's entry count, then fills by
  occurrence. If the site's "Add" button uses unusual markup, rows are not
  added and only the first entry is filled.
- Education dates and degrees with unusual formatting may be skipped.

## Dates

- Workday split date widgets are supported (Month/Day/Year selects or inputs),
  as are plain text/`date` inputs. Formats like `MM/YYYY`, `MM/DD/YYYY`,
  `YYYY-MM-DD`, and `"January 2019"` are parsed. `Present`/`Current` end dates
  are handled (left empty or filled as text depending on the widget).

## Safety guarantees

- **Never** fills email/password on Sign-in or Create-Account screens (they are
  detected and the extension asks you to log in manually).
- **Never** clicks Submit / Submit Application.
- All data stays in `chrome.storage.local`; the only network calls are to
  your chosen AI provider (`api.openai.com`, `api.deepseek.com`,
  `generativelanguage.googleapis.com`, or `api.anthropic.com`) for
  parsing/mapping when you trigger them, plus the **opt-in** analytics
  endpoint you configure.
