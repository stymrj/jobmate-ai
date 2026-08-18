/**
 * mapper.js - Field Mapper Module
 * 
 * Maps form field labels to structured resume data.
 * Uses heuristic keyword matching first (fast, free),
 * falls back to AI for unrecognized fields.
 */

const FieldMapper = {

  /**
   * Heuristic mapping dictionary.
   * Keys are lowercase patterns that might appear in field labels.
   * Values are dot-notation paths into the resume JSON.
   */
  FIELD_MAP: {
    // Personal Info
    'first name': 'firstName',
    'given name': 'firstName',
    'fname': 'firstName',
    'last name': 'lastName',
    'family name': 'lastName',
    'surname': 'lastName',
    'lname': 'lastName',
    'full name': '_fullName',  // special: computed
    'email': 'email',
    'e-mail': 'email',
    'email address': 'email',
    'phone': 'phone',
    'phone number': 'phone',
    'mobile': 'phone',
    'telephone': 'phone',
    'cell': 'phone',
    'contact number': 'phone',
    
    // Address
    'address': 'location.address',
    'street': 'location.address',
    'address line': 'location.address',
    'city': 'location.city',
    'state': 'location.state',
    'province': 'location.state',
    'country': 'location.country',
    'zip': 'location.zip',
    'zip code': 'location.zip',
    'postal code': 'location.zip',
    'postal': 'location.zip',
    
    // Links
    'linkedin': 'linkedin',
    'github': 'github',
    'portfolio': 'portfolio',
    'website': 'portfolio',
    'personal website': 'portfolio',
    
    // Professional
    'job title': 'workExperience[0].title',
    'current title': 'workExperience[0].title',
    'current company': 'workExperience[0].company',
    'current employer': 'workExperience[0].company',
    'company': 'workExperience[0].company',
    'employer': 'workExperience[0].company',
    'organization': 'workExperience[0].company',
    'years of experience': 'yearsOfExperience',
    'total experience': 'yearsOfExperience',
    'summary': 'summary',
    'professional summary': 'summary',
    'cover letter': 'summary',
    'start date': 'workExperience[0].startDate',
    'end date': 'workExperience[0].endDate',
    'date of employment': 'workExperience[0].startDate',
    'job description': 'workExperience[0].description',
    'responsibilities': 'workExperience[0].description',
    'key achievements': 'workExperience[0].description',
    'job location': 'workExperience[0].location',
    
    // Education
    'degree': 'education[0].degree',
    'diploma': 'education[0].degree',
    'school': 'education[0].school',
    'university': 'education[0].school',
    'college': 'education[0].school',
    'institution': 'education[0].school',
    'field of study': 'education[0].field',
    'major': 'education[0].field',
    'area of study': 'education[0].field',
    'gpa': 'education[0].gpa',
    
    // Authorization / relocation (boolean -> Yes/No)
    'authorized to work': 'authorizedToWork',
    'work authorization': 'authorizedToWork',
    'legally authorized': 'authorizedToWork',
    'requires sponsorship': 'requiresSponsorship',
    'sponsorship': 'requiresSponsorship',
    'willing to relocate': 'willingToRelocate',
    'relocate': 'willingToRelocate',
  },

  /**
   * Map a field label to the best matching resume value.
   * Tries heuristic first, then the mapping cache (learned from previous
   * fills / pages), and only falls back to AI for unrecognized fields.
   * 
   * @param {string} label - The form field label text
   * @param {string} fieldType - Type of field (text, dropdown, date, radio, checkbox)
   * @param {Array} options - Available options for dropdown/radio
   * @param {object} resumeData - Structured resume JSON
   * @param {number} occurrenceIndex - 0-based occurrence of this label on the
   *   page (for repeatable Work Experience / Education entries)
   * @param {object|null} context - { step } for step-aware disambiguation
   * @param {object|null} cache - Optional MappingCache (label → value). Reuses
   *   confirmed values so repeat applications never call the AI again.
   * @returns {Promise<{value: string, confidence: string, source: string}>}
   */
  async mapField(label, fieldType, options, resumeData, occurrenceIndex = 0, context = null, cache = null) {
    // Step 1: Try heuristic match
    const heuristicResult = this.heuristicMatch(label, resumeData, occurrenceIndex, context);
    if (heuristicResult !== null) {
      const bestOption = this.matchToOptions(heuristicResult, fieldType, options);
      if (bestOption) {
        return { value: bestOption, confidence: 'high', source: 'heuristic' };
      }
      return { value: heuristicResult, confidence: 'high', source: 'heuristic' };
    }

    // Step 2: Reuse values confirmed on earlier pages/applications — this is
    // what keeps repeat fills free (no AI call).
    if (cache) {
      try {
        const cachedValue = await cache.get(label, occurrenceIndex);
        if (cachedValue) {
          const bestOption = this.matchToOptions(cachedValue, fieldType, options);
          const usable = bestOption || (fieldType !== 'dropdown' && fieldType !== 'radio');
          if (usable) {
            return { value: bestOption || cachedValue, confidence: 'high', source: 'cache' };
          }
        }
      } catch (error) {
        console.warn(`[Mapper] Cache lookup failed for "${label}"; continuing:`, error.message);
      }
    }

    // Step 3: Fall back to AI (the only step that costs money) and remember
    // the answer so it is never asked again for the same label.
    try {
      // Assuming AIService is available in the global scope or imported
      const aiResult = await AIService.mapField(label, fieldType, options, resumeData);
      if (aiResult && aiResult.value && cache) {
        cache.set(label, aiResult.value, occurrenceIndex).catch(() => {});
      }
      return {
        value: aiResult.value,
        confidence: aiResult.confidence,
        source: 'ai'
      };
    } catch (error) {
      console.warn(`[Mapper] AI mapping failed for "${label}" (${error.message}); left empty.`);
      return { value: '', confidence: 'low', source: 'failed' };
    }
  },

  /**
   * Resolve a candidate value against a dropdown/radio widget's own options.
   * @returns {string|null} The matching option text, or null if no option
   *   matches (or the widget is not option-based).
   */
  matchToOptions(value, fieldType, options) {
    if ((fieldType === 'dropdown' || fieldType === 'radio') && options && options.length > 0) {
      return this.findBestOption(value, options);
    }
    return null;
  },

  /**
   * Try to match a field label using the heuristic dictionary.
   * @param {number} occurrenceIndex - 0-based occurrence of this label on the
   *   page, used to select the right element of array fields (repeatable
   *   Work Experience / Education entries).
   * @param {object|null} context - { step } so ambiguous fields like
   *   "Start Date" resolve to education vs. work experience correctly.
   * @returns {string|null} - Matched value or null
   */
  heuristicMatch(label, resumeData, occurrenceIndex = 0, context = null) {
    if (!label) return null;
    const normalizedLabel = label.toLowerCase().trim();

    // Prefer exact matches, then the longest substring pattern. This prevents
    // short generic words (e.g. "state" inside "United States") from beating
    // longer, more specific patterns (e.g. "legally authorized to work").
    let bestPattern = null;
    let bestLength = -1;
    for (const pattern of Object.keys(this.FIELD_MAP)) {
      if (normalizedLabel === pattern) {
        bestPattern = pattern;
        break;
      }
      if (normalizedLabel.includes(pattern) && pattern.length > bestLength) {
        bestPattern = pattern;
        bestLength = pattern.length;
      }
    }

    if (bestPattern) {
      const resolvedPath = this.resolveArrayBase(this.FIELD_MAP[bestPattern], context);
      return this.getValueByPath(resumeData, resolvedPath, occurrenceIndex);
    }

    return null;
  },

  /**
   * For ambiguous date/education/experience paths, pick the array that matches
   * the step the user is currently on (e.g. "Start Date" on the Education step
   * should read education[0].startDate, not workExperience[0].startDate).
   */
  resolveArrayBase(path, context) {
    if (!context || !context.step) return path;
    const step = String(context.step).toLowerCase();
    if (step.includes('education') && path.startsWith('workExperience')) {
      return path.replace(/^workExperience/, 'education');
    }
    if (step.includes('work') && path.startsWith('education')) {
      return path.replace(/^education/, 'workExperience');
    }
    return path;
  },

  /**
   * Get a value from resume data using dot-notation path.
   * Supports array indexing like 'workExperience[0].title'
   */
  getValueByPath(data, path, occurrenceIndex = 0) {
    if (!data || !path) return null;

    // Handle special computed fields
    if (path === '_fullName') {
      return `${data.firstName || ''} ${data.lastName || ''}`.trim() || null;
    }

    // For repeatable sections, index the occurrence into array paths.
    let indexedPath = path;
    if (occurrenceIndex > 0) {
      indexedPath = path.replace(/\[0\]/g, `[${occurrenceIndex}]`);
    }

    // Parse path with array indices
    const parts = indexedPath.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = data;
    
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    
    // Don't return objects/arrays as values
    if (typeof current === 'object' && current !== null) return null;

    // Normalize booleans (authorizedToWork, requiresSponsorship, etc.) to
    // the Yes/No answers that question widgets expect.
    if (typeof current === 'boolean') return current ? 'Yes' : 'No';
    
    return current !== undefined && current !== null ? String(current) : null;
  },

  /**
   * Find the best matching option from a list of dropdown/radio options.
   * Uses case-insensitive substring matching.
   */
  findBestOption(value, options) {
    if (!value || !options || !Array.isArray(options) || options.length === 0) return null;
    
    const normalizedValue = value.toLowerCase().trim();
    
    // Exact match
    const exact = options.find(opt => typeof opt === 'string' && opt.toLowerCase().trim() === normalizedValue);
    if (exact) return exact;
    
    // Contains match
    const contains = options.find(opt => {
        if (typeof opt !== 'string') return false;
        const lowerOpt = opt.toLowerCase();
        return lowerOpt.includes(normalizedValue) || normalizedValue.includes(lowerOpt);
    });
    if (contains) return contains;
    
    // No match found
    return null;
  }
};
