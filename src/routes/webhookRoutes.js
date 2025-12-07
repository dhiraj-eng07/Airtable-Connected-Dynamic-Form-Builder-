const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const authMiddleware = require('../middlewares/authMiddleware');

// Webhook receiver (no auth required, uses signature verification)
router.post('/airtable', webhookController.handleWebhook);

// Webhook health check
router.get('/health', webhookController.healthCheck);

// Protected webhook management routes
router.use(authMiddleware);
router.post('/register', webhookController.registerWebhook);
router.get('/list', webhookController.listWebhooks);
router.post('/:webhookId/refresh', webhookController.refreshWebhook);
router.delete('/:webhookId', webhookController.deleteWebhook);
router.post('/forms/:formId/sync', webhookController.manualSync);

module.exports = router;