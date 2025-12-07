const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  airtableUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  displayName: {
    type: String,
    trim: true
  },
  profilePicture: {
    type: String
  },
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String,
    required: true
  },
  tokenExpiresAt: {
    type: Date,
    required: true
  },
  airtableScopes: [{
    type: String
  }],
  lastLoginAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.accessToken;
      delete ret.refreshToken;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ isActive: 1 });

// Methods
userSchema.methods.isTokenExpired = function() {
  return this.tokenExpiresAt < new Date();
};

userSchema.methods.hasValidToken = function() {
  return !this.isTokenExpired() && this.isActive;
};

userSchema.methods.getSafeProfile = function() {
  return {
    id: this._id,
    airtableUserId: this.airtableUserId,
    email: this.email,
    displayName: this.displayName,
    profilePicture: this.profilePicture,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt
  };
};

// Static methods
userSchema.statics.findByAirtableId = function(airtableUserId) {
  return this.findOne({ airtableUserId, isActive: true });
};

userSchema.statics.updateTokens = async function(airtableUserId, tokenData) {
  return this.findOneAndUpdate(
    { airtableUserId },
    {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)),
      lastLoginAt: new Date()
    },
    { new: true, upsert: false }
  );
};

const User = mongoose.model('User', userSchema);

module.exports = User;