const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/User');
const TokenManager = require('../utils/tokenManager');
const logger = require('../utils/logger');

class AuthController {
  constructor() {
    this.tokenManager = TokenManager;
  }

  /**
   * Initiate Airtable OAuth flow
   */
  async initiateOAuth(req, res) {
    try {
      const state = crypto.randomBytes(32).toString('hex');
      
      // Store state in session or cache for verification
      req.session.oauthState = state;
      
      const params = new URLSearchParams({
        client_id: process.env.AIRTABLE_CLIENT_ID,
        redirect_uri: process.env.AIRTABLE_REDIRECT_URI,
        scope: process.env.AIRTABLE_SCOPE || 'data.records:read data.records:write schema.bases:read',
        state: state,
        response_type: 'code'
      });

      const authUrl = `https://airtable.com/oauth2/v1/authorize?${params.toString()}`;
      
      res.json({
        success: true,
        authUrl
      });

    } catch (error) {
      logger.error('OAuth initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to initiate OAuth flow'
      });
    }
  }

  /**
   * Handle OAuth callback from Airtable
   */
  async handleCallback(req, res) {
    try {
      const { code, state } = req.query;
      const { oauthState } = req.session;

      // Verify state to prevent CSRF
      if (!state || state !== oauthState) {
        return res.status(400).json({
          success: false,
          error: 'Invalid state parameter'
        });
      }

      // Clear state from session
      delete req.session.oauthState;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Authorization code is required'
        });
      }

      // Exchange code for tokens
      const tokenResponse = await axios.post(
        'https://airtable.com/oauth2/v1/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: process.env.AIRTABLE_REDIRECT_URI,
          client_id: process.env.AIRTABLE_CLIENT_ID,
          client_secret: process.env.AIRTABLE_CLIENT_SECRET
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Get user info from Airtable
      const userInfoResponse = await axios.get('https://api.airtable.com/v0/meta/whoami', {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      });

      const airtableUser = userInfoResponse.data;

      // Create or update user in database
      let user = await User.findOne({ airtableUserId: airtableUser.id });
      
      const userData = {
        airtableUserId: airtableUser.id,
        email: airtableUser.email,
        displayName: airtableUser.name || airtableUser.email,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + (expires_in * 1000)),
        airtableScopes: (process.env.AIRTABLE_SCOPE || '').split(' '),
        lastLoginAt: new Date(),
        isActive: true
      };

      if (user) {
        // Update existing user
        Object.assign(user, userData);
        await user.save();
      } else {
        // Create new user
        user = new User(userData);
        await user.save();
      }

      // Generate JWT for our app
      const appToken = this.tokenManager.generateToken(user);

      // Return success response
      res.json({
        success: true,
        token: appToken,
        user: user.getSafeProfile(),
        expiresIn: expires_in
      });

    } catch (error) {
      logger.error('OAuth callback failed:', error.response?.data || error.message);
      
      let errorMessage = 'Authentication failed';
      let statusCode = 500;

      if (error.response) {
        if (error.response.status === 400) {
          errorMessage = 'Invalid authorization code';
          statusCode = 400;
        } else if (error.response.status === 401) {
          errorMessage = 'Invalid client credentials';
          statusCode = 401;
        }
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage
      });
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
      }

      // Find user by refresh token
      const user = await User.findOne({ refreshToken, isActive: true });
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid refresh token'
        });
      }

      // Exchange refresh token for new access token
      const tokenResponse = await axios.post(
        'https://airtable.com/oauth2/v1/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.AIRTABLE_CLIENT_ID,
          client_secret: process.env.AIRTABLE_CLIENT_SECRET
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Update user tokens
      user.accessToken = access_token;
      user.refreshToken = refresh_token;
      user.tokenExpiresAt = new Date(Date.now() + (expires_in * 1000));
      user.lastLoginAt = new Date();
      await user.save();

      // Generate new app token
      const appToken = this.tokenManager.generateToken(user);

      res.json({
        success: true,
        token: appToken,
        user: user.getSafeProfile(),
        expiresIn: expires_in
      });

    } catch (error) {
      logger.error('Token refresh failed:', error.response?.data || error.message);
      
      res.status(401).json({
        success: false,
        error: 'Failed to refresh token'
      });
    }
  }

  /**
   * Revoke Airtable access
   */
  async revokeAccess(req, res) {
    try {
      const userId = req.user.userId;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Revoke token with Airtable
      try {
        await axios.post(
          'https://airtable.com/oauth2/v1/revoke',
          new URLSearchParams({
            token: user.accessToken,
            client_id: process.env.AIRTABLE_CLIENT_ID,
            client_secret: process.env.AIRTABLE_CLIENT_SECRET
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
      } catch (revokeError) {
        logger.warn('Airtable token revocation failed:', revokeError.message);
        // Continue anyway - we'll still deactivate the user locally
      }

      // Deactivate user locally
      user.isActive = false;
      await user.save();

      res.json({
        success: true,
        message: 'Access revoked successfully'
      });

    } catch (error) {
      logger.error('Access revocation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke access'
      });
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check if token needs refresh
      if (user.isTokenExpired()) {
        return res.status(401).json({
          success: false,
          error: 'Token expired, please reauthenticate'
        });
      }

      res.json({
        success: true,
        user: user.getSafeProfile()
      });

    } catch (error) {
      logger.error('Get profile failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get profile'
      });
    }
  }

  /**
   * Logout user
   */
  async logout(req, res) {
    try {
      // Clear session if using sessions
      if (req.session) {
        req.session.destroy();
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to logout'
      });
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(req, res) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          success: false,
          authenticated: false
        });
      }

      const decoded = this.tokenManager.verifyToken(token);
      
      if (!decoded) {
        return res.status(401).json({
          success: false,
          authenticated: false
        });
      }

      const user = await User.findById(decoded.userId);
      
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          authenticated: false
        });
      }

      res.json({
        success: true,
        authenticated: true,
        user: user.getSafeProfile()
      });

    } catch (error) {
      res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Authentication check failed'
      });
    }
  }
}

module.exports = new AuthController();