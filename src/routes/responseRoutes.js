const express = require('express');
const router = express.Router();
const responseController = require('../controllers/responseController');
const authMiddleware = require('../middlewares/authMiddleware');

// Public submission (no auth required)
router.post('/:formId/submit', responseController.submitResponse);

// Protected routes
router.use(authMiddleware);

// Response management
router.get('/form/:formId', responseController.getFormResponses);
router.get('/:responseId', responseController.getResponse);
router.put('/:responseId', responseController.updateResponse);
router.delete('/:responseId', responseController.deleteResponse);
router.post('/:responseId/sync', responseController.syncResponse);

// Export
router.get('/form/:formId/export', responseController.exportResponses);

module.exports = router;