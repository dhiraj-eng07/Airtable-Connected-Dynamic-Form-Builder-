const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// OAuth initiation
router.get('/airtable/initiate', authController.initiateOAuth);

// OAuth callback
router.get('/airtable/callback', authController.handleCallback);

// Token refresh
router.post('/refresh', authController.refreshToken);

// Check authentication status
router.get('/check', authController.checkAuth);

// Protected routes
router.get('/profile', authMiddleware, authController.getProfile);
router.post('/logout', authMiddleware, authController.logout);
router.post('/revoke', authMiddleware, authController.revokeAccess);

module.exports = router;