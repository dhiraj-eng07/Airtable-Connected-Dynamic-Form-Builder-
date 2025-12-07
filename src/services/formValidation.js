class FormValidator {
  constructor() {
    this.supportedTypes = [
      'shortText',
      'longText',
      'singleSelect',
      'multiSelect',
      'attachment'
    ];

    this.airtableTypeMap = {
      'singleLineText': 'shortText',
      'email': 'shortText',
      'url': 'shortText',
      'multilineText': 'longText',
      'richText': 'longText',
      'singleSelect': 'singleSelect',
      'multipleSelects': 'multiSelect',
      'multipleAttachments': 'attachment'
    };
  }

  /**
   * Validate questions against Airtable fields
   */
  validateQuestions(questions, airtableFields) {
    const errors = [];
    const usedQuestionKeys = new Set();
    const usedAirtableIds = new Set();

    // Validate each question
    questions.forEach((question, index) => {
      // Check question key
      if (!question.questionKey || typeof question.questionKey !== 'string') {
        errors.push(`Question ${index}: questionKey is required and must be a string`);
      } else if (usedQuestionKeys.has(question.questionKey)) {
        errors.push(`Question ${index}: duplicate questionKey "${question.questionKey}"`);
      } else {
        usedQuestionKeys.add(question.questionKey);
      }

      // Check Airtable field ID
      if (!question.airtableFieldId) {
        errors.push(`Question ${index}: airtableFieldId is required`);
      } else if (usedAirtableIds.has(question.airtableFieldId)) {
        errors.push(`Question ${index}: duplicate airtableFieldId "${question.airtableFieldId}"`);
      } else {
        usedAirtableIds.add(question.airtableFieldId);
      }

      // Check label
      if (!question.label || typeof question.label !== 'string') {
        errors.push(`Question ${index}: label is required and must be a string`);
      }

      // Check type
      if (!question.type || !this.supportedTypes.includes(question.type)) {
        errors.push(`Question ${index}: type must be one of: ${this.supportedTypes.join(', ')}`);
      }

      // Check required field
      if (typeof question.required !== 'boolean') {
        errors.push(`Question ${index}: required must be a boolean`);
      }

      // Validate against Airtable field
      const airtableField = airtableFields.find(f => f.id === question.airtableFieldId);
      
      if (!airtableField) {
        errors.push(`Question ${index}: Airtable field "${question.airtableFieldId}" not found`);
      } else if (airtableField.type !== question.type) {
        // Check if the mapped type matches
        const mappedType = this.airtableTypeMap[airtableField.airtableType];
        if (mappedType !== question.type) {
          errors.push(`Question ${index}: type "${question.type}" doesn't match Airtable field type "${airtableField.airtableType}"`);
        }
      }

      // Validate options for select fields
      if (question.type === 'singleSelect' || question.type === 'multiSelect') {
        if (!question.options || !Array.isArray(question.options)) {
          errors.push(`Question ${index}: options array is required for select fields`);
        } else if (question.options.length === 0) {
          errors.push(`Question ${index}: options array cannot be empty for select fields`);
        } else {
          // Validate each option
          question.options.forEach((option, optIndex) => {
            if (!option.value || typeof option.value !== 'string') {
              errors.push(`Question ${index}, option ${optIndex}: value is required and must be a string`);
            }
            if (!option.label || typeof option.label !== 'string') {
              errors.push(`Question ${index}, option ${optIndex}: label is required and must be a string`);
            }
          });
        }
      }

      // Validate validation rules
      if (question.validationRules) {
        if (question.validationRules.minLength !== undefined && 
            typeof question.validationRules.minLength !== 'number') {
          errors.push(`Question ${index}: validationRules.minLength must be a number`);
        }
        if (question.validationRules.maxLength !== undefined && 
            typeof question.validationRules.maxLength !== 'number') {
          errors.push(`Question ${index}: validationRules.maxLength must be a number`);
        }
        if (question.validationRules.pattern !== undefined && 
            typeof question.validationRules.pattern !== 'string') {
          errors.push(`Question ${index}: validationRules.pattern must be a string`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Validate answer against question type
   */
  validateAnswer(question, answer) {
    if (question.required && (answer === undefined || answer === null || answer === '')) {
      return { isValid: false, error: 'This field is required' };
    }

    // If not required and empty, it's valid
    if (answer === undefined || answer === null || answer === '') {
      return { isValid: true };
    }

    switch (question.type) {
      case 'shortText':
      case 'longText':
        if (typeof answer !== 'string') {
          return { isValid: false, error: 'Must be text' };
        }
        if (question.validationRules) {
          if (question.validationRules.minLength && answer.length < question.validationRules.minLength) {
            return { isValid: false, error: `Minimum ${question.validationRules.minLength} characters required` };
          }
          if (question.validationRules.maxLength && answer.length > question.validationRules.maxLength) {
            return { isValid: false, error: `Maximum ${question.validationRules.maxLength} characters allowed` };
          }
          if (question.validationRules.pattern) {
            const regex = new RegExp(question.validationRules.pattern);
            if (!regex.test(answer)) {
              return { isValid: false, error: 'Invalid format' };
            }
          }
        }
        break;

      case 'singleSelect':
        if (typeof answer !== 'string') {
          return { isValid: false, error: 'Must be a single selection' };
        }
        if (!question.options.some(opt => opt.value === answer)) {
          return { isValid: false, error: 'Invalid selection' };
        }
        break;

      case 'multiSelect':
        if (!Array.isArray(answer)) {
          return { isValid: false, error: 'Must be an array of selections' };
        }
        if (answer.some(val => !question.options.some(opt => opt.value === val))) {
          return { isValid: false, error: 'Contains invalid selections' };
        }
        break;

      case 'attachment':
        if (!Array.isArray(answer)) {
          return { isValid: false, error: 'Must be an array of file information' };
        }
        // Validate each file object
        if (answer.some(file => !file.url || !file.filename)) {
          return { isValid: false, error: 'Each file must have url and filename' };
        }
        break;

      default:
        return { isValid: false, error: `Unsupported question type: ${question.type}` };
    }

    return { isValid: true };
  }

  /**
   * Sanitize user input based on question type
   */
  sanitizeAnswer(question, answer) {
    if (answer === undefined || answer === null) {
      return '';
    }

    switch (question.type) {
      case 'shortText':
      case 'longText':
        return String(answer).trim();

      case 'singleSelect':
        return String(answer);

      case 'multiSelect':
        if (Array.isArray(answer)) {
          return answer.map(item => String(item));
        }
        return [String(answer)];

      case 'attachment':
        if (Array.isArray(answer)) {
          return answer.map(file => ({
            filename: String(file.filename || ''),
            url: String(file.url || ''),
            size: Number(file.size) || 0,
            type: String(file.type || '')
          }));
        }
        return [];

      default:
        return answer;
    }
  }

  /**
   * Check if Airtable field type is supported
   */
  isSupportedAirtableType(airtableType) {
    return Object.keys(this.airtableTypeMap).includes(airtableType);
  }

  /**
   * Get supported Airtable fields from table
   */
  getSupportedFields(airtableFields) {
    return airtableFields.filter(field => 
      this.isSupportedAirtableType(field.airtableType)
    );
  }
}

module.exports = new FormValidator();