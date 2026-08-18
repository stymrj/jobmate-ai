# Privacy Policy — JobMate AI

**Last updated:** August 2026

JobMate AI ("the extension") helps users fill out job application forms on
career websites (Workday, Greenhouse, Lever, and others) from a resume the
user uploads. This policy describes what data is processed, where it goes,
and what the user controls.

## 1. What stays on your device

Everything below is stored only in the extension's local browser storage
(`chrome.storage.local`) on the user's own device and never sent to us:

- The parsed resume (name, contact details, work experience, education, skills)
- The original resume file (PDF/DOCX) the user uploaded
- Extension settings (AI provider choice, API key if the user provides one,
  analytics preference)
- A local cache of previously confirmed field values (used to avoid repeating
  AI calls on future applications)

## 2. What leaves the device

- **AI provider calls (optional, user-initiated).** When the user enables AI
  features and provides their own key (or uses the admin-provided shared key),
  the resume text and the labels of the form fields being filled are sent to
  the AI provider the user selected in Settings — OpenAI, Google Gemini,
  DeepSeek, or Anthropic Claude. This happens only when the user uses an AI
  feature, and the destination is always the provider the user chose. The
  extension never sends this data anywhere else.
- **Anonymous usage statistics (off by default).** If the user explicitly
  enables "Send anonymous usage statistics", the extension sends batched,
  anonymous events (extension installed, resume saved, autofill started,
  number of fields filled, site host) to the admin endpoint configured in
  Settings. Events contain a randomly generated ID, never names, emails, or
  resume content. Disabling analytics stops all such transmissions.

## 3. What we do not do

- We do not collect, store, or sell user data on our own servers.
- We do not use the data for anything other than filling application forms
  (the extension's single purpose).
- The extension contains no remote code, no ads, and no trackers.

## 4. Permissions

The extension uses the `<all_urls>` host permission because job application
forms appear on any career site. It detects and fills only pages that contain
a fillable job-application form; it does not read or alter other content.

## 5. User control and deletion

Users can remove their resume, settings, and cache at any time by clearing the
extension's data via the popup or by removing the extension in
`chrome://extensions` (which deletes all locally stored data).

## 6. Contact

Questions about this policy: <contact@jobmate-ai.com>