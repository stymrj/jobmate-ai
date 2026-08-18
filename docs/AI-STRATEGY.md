# AI Strategy

This document describes how JobMate AI decides what value goes into each
form field, and why.

## Layered resolution

Every fillable field is resolved through the same pipeline in
`src/content.js` (`processCurrentPage`):

```
1. Resume/CV upload field?        -> attach stored PDF/DOCX directly
2. Is it a screening/EEO question? -> AI question prompt, then heuristics
3. Otherwise: field mapping         -> heuristic dictionary, then AI mapping
4. Validate required fields         -> warn about anything left empty
```

## 1. Resume parsing (`ai-service.js` → `handleStructureResume`)

Raw text from the PDF/DOCX is sent to the **user-selected AI provider** —
OpenAI, Google Gemini, DeepSeek, or Anthropic Claude (chosen in the popup
Settings, `aiProvider` + optional `aiModel` override) — in JSON mode with a
strict output schema: contact info, `workExperience[]`, `education[]`, skills,
languages, and the three booleans used by screening questions
(`authorizedToWork`, `requiresSponsorship`, `willingToRelocate`). Dates are
normalized to `MM/YYYY`; the current job gets `endDate: "Present"`.

The routing lives in `src/background.js` (`callLLM`): OpenAI/DeepSeek use the
Chat Completions format with `response_format: {type:'json_object'}`; Gemini
uses `responseMimeType: 'application/json'` on the Generative Language API;
Claude gets the JSON constraint in its system prompt (its API has no strict
JSON mode). API keys are read from the shared settings and never leave the
background worker.

## 2. Field mapping (`mapper.js`)

### Heuristic dictionary (fast, free, always first)

`FIELD_MAP` maps label substrings to resume paths, e.g.
`'job title' → workExperience[0].title`. Matching rules:

- **Exact label match wins** over substring matches.
- Otherwise the **longest** matching substring wins. This matters because
  labels are usually full sentences — e.g. *"Are you legally authorized to work
  in the United States?"* must match `legally authorized` and **not** the
  shorter `state` from *"United States"*.
- Booleans in the resume (`authorizedToWork`, …) are emitted as `Yes`/`No`.
- **Step-aware arrays** (`resolveArrayBase`): on the *Education* step, a
  `Start Date` field resolves to `education[i].startDate`; on the *Work
  Experience* step it resolves to `workExperience[i].startDate`.
- **Occurrence indexing**: repeated labels on one page (Job Title #2, #3, …)
  map to `workExperience[1]`, `workExperience[2]`, …

### AI mapping fallback (`handleMapField`)

If the heuristic finds nothing, the configured AI provider maps the label to
the resume JSON. The prompt requires that dropdown/radio answers come **only
from the widget's own options**, and returns a `confidence` + `reasoning` so
the user can audit the choice.

## 3. Screening / EEO / Yes-No questions (`fillQuestionField`)

Question fields are recognized via the step name (Questions / Voluntary
Disclosures), a `?` in the label, question keywords (gender, ethnicity, veteran
status, sponsorship, work authorization, relocation, …), or Yes/No radio
groups.

They are answered with a **dedicated prompt** (`handleAnswerQuestion`) that:

- Always constrains the answer to the widget's available options.
- Answers authorization / sponsorship / relocation questions **only** when the
  resume carries that data (the `authorizedToWork`, `requiresSponsorship`,
  `willingToRelocate` fields) — at high confidence when present.
- For EEO items (gender, race, veteran, disability) returns
  **"Decline to self-identify"** at low confidence — the extension never
  fabricates demographic data.

### Heuristic fallback (no API key / AI down)

The same Yes/No/relocation values are answered from the resume booleans using
`heuristicMatch`; anything unresolvable is left empty and shown as ⚠ for the
user to answer.

## 4. Why the extension never auto-submits

`detectCurrentStep` marks Review/Submit pages (few inputs + "review"/"submit"
copy, or a Submit button). On those pages the pipeline stops and shows a
notice; the final click is always yours.
