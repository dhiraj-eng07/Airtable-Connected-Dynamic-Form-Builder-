const mongoose = require('mongoose');
const { Schema } = mongoose;

const answerSchema = new Schema({
  questionKey: {
    type: String,
    required: true
  },
  value: {
    type: Schema.Types.Mixed
  },
  files: [{
    filename: String,
    url: String,
    size: Number,
    type: String
  }],
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const responseSchema = new Schema({
  formId: {
    type: Schema.Types.ObjectId,
    ref: 'Form',
    required: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  airtableRecordId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'synced', 'failed', 'deleted'],
    default: 'submitted'
  },
  answers: [answerSchema],
  submittedBy: {
    ip: String,
    userAgent: String,
    referrer: String
  },
  syncStatus: {
    lastSyncedAt: Date,
    syncAttempts: {
      type: Number,
      default: 0
    },
    syncError: String
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
responseSchema.index({ formId: 1, createdAt: -1 });
responseSchema.index({ airtableRecordId: 1 }, { unique: true });
responseSchema.index({ status: 1, createdAt: -1 });
responseSchema.index({ 'syncStatus.lastSyncedAt': -1 });
responseSchema.index({ 'answers.questionKey': 1 });

// Methods
responseSchema.methods.getAnswer = function(questionKey) {
  const answer = this.answers.find(a => a.questionKey === questionKey);
  return answer ? answer.value : null;
};

responseSchema.methods.getAnswerWithFiles = function(questionKey) {
  return this.answers.find(a => a.questionKey === questionKey);
};

responseSchema.methods.updateSyncStatus = function(success, error = null) {
  this.syncStatus.lastSyncedAt = new Date();
  this.syncStatus.syncAttempts += 1;
  
  if (success) {
    this.status = 'synced';
    this.syncStatus.syncError = null;
  } else {
    this.status = 'failed';
    this.syncStatus.syncError = error;
  }
  
  return this.save();
};

// Static methods
responseSchema.statics.findByForm = function(formId, options = {}) {
  const query = { formId };
  
  if (options.status) {
    query.status = options.status;
  }
  
  if (options.excludeDeleted) {
    query.status = { $ne: 'deleted' };
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 100)
    .populate('formId', 'title description');
};

responseSchema.statics.findByAirtableId = function(airtableRecordId) {
  return this.findOne({ airtableRecordId });
};

responseSchema.statics.markAsDeleted = function(airtableRecordId) {
  return this.findOneAndUpdate(
    { airtableRecordId },
    {
      status: 'deleted',
      'syncStatus.lastSyncedAt': new Date()
    },
    { new: true }
  );
};

responseSchema.statics.getStats = async function(formId) {
  const stats = await this.aggregate([
    { $match: { formId: mongoose.Types.ObjectId(formId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        latest: { $max: '$createdAt' }
      }
    }
  ]);
  
  return stats.reduce((acc, curr) => {
    acc[curr._id] = { count: curr.count, latest: curr.latest };
    return acc;
  }, {});
};

const Response = mongoose.model('Response', responseSchema);

module.exports = Response;