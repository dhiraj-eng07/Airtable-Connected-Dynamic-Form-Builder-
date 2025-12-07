const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('./logger');

class TokenManager {
  constructor() {
    this.secret = process.env.JWT_SECRET;
    this.expiresIn = process.env.JWT_EXPIRE || '7d';
    
    if (!this.secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  /**
   * Generate JWT token for user
   */
  generateToken(user) {
    const payload = {
      userId: user._id,
      email: user.email,
      airtableUserId: user.airtableUserId,
      scope: 'user'
    };

    const options = {
      expiresIn: this.expiresIn,
      issuer: 'airtable-form-builder',
      subject: user._id.toString()
    };

    return jwt.sign(payload, this.secret, options);
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.secret, {
        issuer: 'airtable-form-builder'
      });
    } catch (error) {
      logger.error('Token verification failed:', error.message);
      return null;
    }
  }

  /**
   * Decode token without verification
   */
  decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch (error) {
      logger.error('Token decoding failed:', error);
      return null;
    }
  }

  /**
   * Check if token is about to expire
   */
  isTokenExpiringSoon(token, thresholdMinutes = 30) {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.exp) {
      return true;
    }

    const expiresAt = decoded.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const thresholdMs = thresholdMinutes * 60 * 1000;

    return (expiresAt - now) < thresholdMs;
  }

  /**
   * Generate a secure random token for various purposes
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate API key for programmatic access
   */
  generateApiKey(userId, name) {
    const apiKey = this.generateSecureToken(64);
    const apiKeyHash = this.hashToken(apiKey);
    
    const payload = {
      type: 'api_key',
      userId: userId,
      name: name,
      hash: apiKeyHash
    };

    const token = jwt.sign(payload, this.secret, {
      expiresIn: '365d',
      issuer: 'airtable-form-builder'
    });

    return {
      key: apiKey,
      token: token
    };
  }

  /**
   * Hash a token for secure storage
   */
  hashToken(token) {
    return crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
  }

  /**
   * Verify API key
   */
  verifyApiKey(apiKey, storedHash) {
    const hash = this.hashToken(apiKey);
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(storedHash)
    );
  }

  /**
   * Generate short-lived token for email verification, password reset, etc.
   */
  generateShortLivedToken(payload, expiresIn = '1h') {
    return jwt.sign(payload, this.secret, {
      expiresIn: expiresIn,
      issuer: 'airtable-form-builder'
    });
  }

  /**
   * Get token expiration date
   */
  getTokenExpiration(token) {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.exp) {
      return null;
    }
    return new Date(decoded.exp * 1000);
  }

  /**
   * Refresh token if it's about to expire
   */
  refreshTokenIfNeeded(token, user) {
    if (this.isTokenExpiringSoon(token)) {
      return this.generateToken(user);
    }
    return token;
  }
}

module.exports = new TokenManager();