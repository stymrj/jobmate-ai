/**
 * ai-service.js - AI Service Module
 * 
 * Handles AI communication for resume parsing, field mapping, and
 * question answering.
 * 
 * In content script context: sends messages to the background worker,
 * which routes the request to the user-selected provider
 * (OpenAI / Gemini / DeepSeek / Claude) — see background.js callLLM().
 * In background context: makes actual API calls.
 */

const AIService = {

  /**
   * Send a request to the background worker to call the configured AI provider.
   * @param {string} action - The action type
   * @param {object} data - The request data
   * @returns {Promise<object>} - The AI response
   */
  async sendToBackground(action, data) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'AI_REQUEST', action, data },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.result);
        }
      );
    });
  },

  /**
   * Structure raw resume text into a JSON object using AI.
   * @param {string} rawText - The raw text extracted from resume
   * @returns {Promise<object>} - Structured resume JSON
   */
  async structureResume(rawText) {
    return this.sendToBackground('STRUCTURE_RESUME', { rawText });
  },

  /**
   * Map a form field to the best matching resume data.
   * @param {string} fieldLabel - The label/description of the form field
   * @param {string} fieldType - The type of field (text, dropdown, date, etc.)
   * @param {Array} options - Available options for dropdown/radio fields
   * @param {object} resumeData - The structured resume JSON
   * @returns {Promise<object>} - { value, confidence }
   */
  async mapField(fieldLabel, fieldType, options, resumeData) {
    return this.sendToBackground('MAP_FIELD', { fieldLabel, fieldType, options, resumeData });
  },

  /**
   * Answer a screening/application question.
   * @param {string} question - The question text
   * @param {Array} options - Available answer options (if any)
   * @param {object} resumeData - The structured resume JSON
   * @returns {Promise<object>} - { answer, confidence }
   */
  async answerQuestion(question, options, resumeData) {
    return this.sendToBackground('ANSWER_QUESTION', { question, options, resumeData });
  },

  // =========================================================
  // BACKGROUND-SIDE METHODS (called by background.js)
  // These make the actual OpenAI API calls
  // =========================================================

  /**
   * Call OpenAI API
   * @param {string} apiKey - OpenAI API key
   * @param {Array} messages - Chat messages array
   * @param {boolean} jsonMode - Whether to request JSON output
   * @returns {Promise<string>} - The response text
   */
  async callOpenAI(apiKey, messages, jsonMode = false) {
    const body = {
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1, // Low temperature for consistent outputs
      max_tokens: 4000
    };
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${err.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  },

  /**
   * [BACKGROUND] Structure resume text into JSON
   */
  async handleStructureResume(apiKey, rawText) {
    const prompt = `You are a resume parser. Extract structured data from the following resume text and return it as a JSON object.

Return EXACTLY this JSON structure (use empty strings for missing fields, empty arrays for missing lists):
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "location": {
    "address": "",
    "city": "",
    "state": "",
    "country": "",
    "zip": ""
  },
  "linkedin": "",
  "github": "",
  "portfolio": "",
  "summary": "",
  "workExperience": [
    {
      "title": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": ""
    }
  ],
  "education": [
    {
      "degree": "",
      "school": "",
      "field": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "gpa": ""
    }
  ],
  "skills": [],
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "date": ""
    }
  ],
  "languages": [],
  "yearsOfExperience": "",
  "willingToRelocate": null,
  "authorizedToWork": null,
  "requiresSponsorship": null
}

Rules:
- Dates should be in MM/YYYY format when possible
- Phone numbers should include country code if available
- Infer country from context clues if not explicitly stated
- If current job, set endDate to "Present" and current to true
- For yearsOfExperience, calculate from work history if not stated
- Keep descriptions concise but complete

Resume text:
${rawText}`;

    const result = await this.callOpenAI(apiKey, [
      { role: 'system', content: 'You are a precise resume parser. Always return valid JSON.' },
      { role: 'user', content: prompt }
    ], true);

    return JSON.parse(result);
  },

  /**
   * [BACKGROUND] Map a field label to resume data
   */
  async handleMapField(apiKey, fieldLabel, fieldType, options, resumeData) {
    let optionsText = options && options.length > 0 ? `- Available options: ${JSON.stringify(options)}` : '';
    let prompt = `You are a form-filling assistant. Given a form field and resume data, determine the best value to fill in.

Form Field:
- Label: "${fieldLabel}"
- Type: ${fieldType}
${optionsText}

Resume Data:
${JSON.stringify(resumeData, null, 2)}

Return a JSON object:
{
  "value": "the value to fill in",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation"
}

Rules:
- If the field is a dropdown/select and has options, the value MUST be one of the available options
- If you can't determine a confident answer, set confidence to "low"
- For "high" confidence: direct match (e.g., "First Name" → firstName)
- For "medium" confidence: semantic match (e.g., "Given Name" → firstName)
- For "low" confidence: best guess or not found
- Return empty string for value if you truly cannot determine it`;

    const result = await this.callOpenAI(apiKey, [
      { role: 'system', content: 'You are a precise form-filling assistant. Always return valid JSON.' },
      { role: 'user', content: prompt }
    ], true);

    return JSON.parse(result);
  },

  /**
   * [BACKGROUND] Answer a screening question
   */
  async handleAnswerQuestion(apiKey, question, options, resumeData) {
    let optionsText = options && options.length > 0 ? `Available answers: ${JSON.stringify(options)}` : 'This is a free-text question.';
    let prompt = `You are a job application assistant. Answer this screening question based on the candidate's resume data.

Question: "${question}"
${optionsText}

Candidate Resume Data:
${JSON.stringify(resumeData, null, 2)}

Return a JSON object:
{
  "answer": "your answer",
  "confidence": "high|medium|low",
  "reasoning": "brief explanation"
}

Rules:
- If options are provided, the answer MUST be one of the available options
- For yes/no questions: answer based on what can be inferred from the resume
- For EEO questions (gender, race, veteran status, disability): set confidence to "low" and answer "Decline to self-identify" or equivalent if available
- For questions about authorization to work, sponsorship needs, etc.: only answer with high confidence if the resume data includes this info
- If you cannot confidently answer, set confidence to "low" and provide your best guess
- Be truthful and conservative - don't fabricate information`;

    const result = await this.callOpenAI(apiKey, [
      { role: 'system', content: 'You are a careful job application assistant. Always return valid JSON.' },
      { role: 'user', content: prompt }
    ], true);

    return JSON.parse(result);
  }
};
