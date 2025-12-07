const express = require('express');
const router = express.Router();
const formController = require('../controllers/formController');
const authMiddleware = require('../middlewares/authMiddleware');

// Apply auth middleware to all routes
router.use(authMiddleware);

// Form management
router.get('/', formController.getUserForms);
router.post('/', formController.createForm);
router.get('/stats', formController.getFormStats);
router.get('/:id', formController.getForm);
router.put('/:id', formController.updateForm);
router.delete('/:id', formController.deleteForm);
router.post('/:id/publish', formController.publishForm);
router.post('/:id/unpublish', formController.unpublishForm);
router.post('/:id/duplicate', formController.duplicateForm);

// Public access (no auth required)
router.get('/public/:id', formController.getPublicForm);

// Airtable data fetching (these would be in separate airtableRoutes in full implementation)
router.get('/:id/bases', async (req, res) => {
  // Implementation for fetching bases
});

router.get('/:id/bases/:baseId/tables', async (req, res) => {
  // Implementation for fetching tables
});

module.exports = router;