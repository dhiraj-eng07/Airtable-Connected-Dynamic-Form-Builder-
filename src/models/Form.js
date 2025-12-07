const mongoose = require('mongoose');
const { Schema } = mongoose;

const conditionSchema = new Schema({
  questionKey: {
    type: String,
    required: true
  },
  operator: {
    type: String,
    enum: ['equals', 'notEquals', 'contains', 'notContains', 'greaterThan', 'lessThan'],
    required: true
  },
  value: {
    type: Schema.Types.Mixed,
    required: true
  }
}, { _id: false });

const conditionalRulesSchema = new Schema({
  logic: {
    type: String,
    enum: ['AND', 'OR'],
    default: 'AND'
  },
  conditions: [conditionSchema]
}, { _id: false });

const questionSchema = new Schema({
  questionKey: {
    type: String,
    required: true
  },
  airtableFieldId: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['shortText', 'longText', 'singleSelect', 'multiSelect', 'attachment'],
    required: true
  },
  required: {
    type: Boolean,
    default: false
  },
  placeholder: {
    type: String,
    trim: true
  },
  helpText: {
    type: String,
    trim: true
  },
  options: [{
    value: String,
    label: String
  }],
  conditionalRules: conditionalRulesSchema,
  order: {
    type: Number,
    required: true,
    min: 0
  },
  validationRules: {
    minLength: Number,
    maxLength: Number,
    pattern: String
  }
}, { _id: false });

const formSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  airtableBaseId: {
    type: String,
    required: true
  },
  airtableTableId: {
    type: String,
    required: true
  },
  airtableTableName: {
    type: String,
    required: true
  },
  questions: [questionSchema],
  settings: {
    theme: {
      primaryColor: {
        type: String,
        default: '#3b82f6'
      },
      backgroundColor: {
        type: String,
        default: '#ffffff'
      }
    },
    submitText: {
      type: String,
      default: 'Submit'
    },
    successMessage: {
      type: String,
      default: 'Thank you for your submission!'
    },
    allowMultipleSubmissions: {
      type: Boolean,
      default: false
    },
    enableProgressBar: {
      type: Boolean,
      default: true
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  publishedAt: {
    type: Date
  },
  version: {
    type: Number,
    default: 1
  },
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
formSchema.index({ userId: 1, createdAt: -1 });
formSchema.index({ airtableBaseId: 1, airtableTableId: 1 });
formSchema.index({ isActive: 1, publishedAt: -1 });
formSchema.index({ 'questions.questionKey': 1 });

// Methods
formSchema.methods.getQuestion = function(questionKey) {
  return this.questions.find(q => q.questionKey === questionKey);
};

formSchema.methods.validateAnswer = function(questionKey, answer) {
  const question = this.getQuestion(questionKey);
  if (!question) {
    return { isValid: false, error: 'Question not found' };
  }

  if (question.required && (answer === undefined || answer === null || answer === '')) {
    return { isValid: false, error: 'This field is required' };
  }

  // Type-specific validation
  switch (question.type) {
    case 'singleSelect':
      if (answer && !question.options.some(opt => opt.value === answer)) {
        return { isValid: false, error: 'Invalid selection' };
      }
      break;
    case 'multiSelect':
      if (answer && (!Array.isArray(answer) || 
          answer.some(val => !question.options.some(opt => opt.value === val)))) {
        return { isValid: false, error: 'Invalid selections' };
      }
      break;
    case 'shortText':
    case 'longText':
      if (answer && typeof answer !== 'string') {
        return { isValid: false, error: 'Must be text' };
      }
      if (question.validationRules) {
        if (question.validationRules.minLength && answer.length < question.validationRules.minLength) {
          return { isValid: false, error: `Minimum ${question.validationRules.minLength} characters required` };
        }
        if (question.validationRules.maxLength && answer.length > question.validationRules.maxLength) {
          return { isValid: false, error: `Maximum ${question.validationRules.maxLength} characters allowed` };
        }
      }
      break;
  }

  return { isValid: true };
};

// Static methods
formSchema.statics.findByUser = function(userId, options = {}) {
  const query = { userId, isActive: true };
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 50);
};

formSchema.statics.findPublished = function(formId) {
  return this.findOne({
    _id: formId,
    isActive: true,
    publishedAt: { $ne: null }
  });
};

const Form = mongoose.model('Form', formSchema);

module.exports = Form;