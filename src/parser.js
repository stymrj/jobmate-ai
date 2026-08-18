/**
 * parser.js - Resume Parser Module
 * 
 * Extracts raw text from PDF and DOCX resume files.
 * Uses PDF.js for PDFs and Mammoth.js for DOCX files.
 * Runs in content script context where libraries are pre-loaded.
 */

const ResumeParser = {
  /**
   * Parse a resume file (PDF or DOCX) and extract raw text.
   * @param {File} file - The resume file object
   * @returns {Promise<string>} - Extracted raw text
   */
  async parseResume(file) {
    if (!file || !(file instanceof File)) {
      throw new Error('Invalid file provided.');
    }

    if (file.size === 0) {
      throw new Error('The provided file is empty.');
    }

    const fileType = this.getFileType(file);
    
    try {
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      
      if (fileType === 'pdf') {
        return await this.parsePDF(arrayBuffer);
      } else if (fileType === 'docx') {
        return await this.parseDOCX(arrayBuffer);
      } else {
        throw new Error(`Unsupported file type: ${file.name}. Please upload a PDF or DOCX file.`);
      }
    } catch (error) {
      console.error('Error in parseResume:', error);
      throw new Error(`Failed to parse resume: ${error.message}`);
    }
  },

  /**
   * Determine file type from extension and MIME type
   * @param {File} file
   * @returns {string} - 'pdf', 'docx', or 'unknown'
   */
  getFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (file.type === 'application/pdf') return 'pdf';
    if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    return 'unknown';
  },

  /**
   * Read a File object as ArrayBuffer
   * @param {File} file
   * @returns {Promise<ArrayBuffer>}
   */
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file into memory'));
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Extract text from PDF using PDF.js
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<string>}
   */
  async parsePDF(arrayBuffer) {
    try {
      // PDF.js needs the worker path set
      if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
      } else {
        throw new Error('PDF.js library is not loaded.');
      }

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Join text items, preserving some structure
        const lines = [];
        let lastY = null;
        let currentLine = '';
        
        for (const item of textContent.items) {
          // If Y position changes significantly, it's a new line
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = '';
          }
          currentLine += item.str + ' ';
          lastY = item.transform[5];
        }
        if (currentLine.trim()) lines.push(currentLine.trim());
        
        pages.push(lines.join('\n'));
      }

      return pages.join('\n\n');
    } catch (error) {
      console.error('PDF parsing error:', error);
      throw new Error(`Could not extract text from PDF: ${error.message}`);
    }
  },

  /**
   * Extract text from DOCX using Mammoth.js
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<string>}
   */
  async parseDOCX(arrayBuffer) {
    try {
      if (typeof mammoth === 'undefined') {
        throw new Error('Mammoth.js library is not loaded.');
      }

      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      console.error('DOCX parsing error:', error);
      throw new Error(`Could not extract text from DOCX: ${error.message}`);
    }
  }
};
