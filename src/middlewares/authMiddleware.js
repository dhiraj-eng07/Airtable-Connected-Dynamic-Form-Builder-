const TokenManager = require('../utils/tokenManager');
const User = require('../models/User');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = TokenManager.verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Get user from database
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive'
      });
    }

    // Check if Airtable token is expired
    if (user.isTokenExpired()) {
      return res.status(401).json({
        success: false,
        error: 'Airtable token expired, please reauthenticate'
      });
    }

    // Attach user to request
    req.user = {
      userId: user._id,
      email: user.email,
      airtableUserId: user.airtableUserId,
      accessToken: user.accessToken
    };

    // Refresh JWT if needed
    const newToken = TokenManager.refreshTokenIfNeeded(token, user);
    if (newToken !== token) {
      res.setHeader('X-New-Token', newToken);
    }

    next();

  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

module.exports = authMiddleware;