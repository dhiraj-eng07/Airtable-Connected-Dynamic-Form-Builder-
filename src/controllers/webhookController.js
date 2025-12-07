const crypto = require('crypto');
const WebhookSyncService = require('../services/webhookSyncService');
const logger = require('../utils/logger');

class WebhookController {
  /**
   * Handle incoming Airtable webhooks
   */
  async handleWebhook(req, res) {
    try {
      const signature = req.headers['x-airtable-webhook-signature'];
      const payload = JSON.stringify(req.body);

      // Verify signature if secret is configured
      if (process.env.WEBHOOK_SECRET) {
        const isValid = WebhookSyncService.verifySignature(payload, signature);
        
        if (!isValid) {
          logger.warn('Invalid webhook signature received');
          return res.status(401).json({
            success: false,
            error: 'Invalid signature'
          });
        }
      }

      // Process webhook
      await WebhookSyncService.processWebhook(req.body);

      res.json({
        success: true,
        message: 'Webhook processed successfully'
      });

    } catch (error) {
      logger.error('Webhook processing failed:', error);
      
      // Still return 200 to Airtable to prevent retries for invalid payloads
      res.status(200).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Register webhook with Airtable
   */
  async registerWebhook(req, res) {
    try {
      const { baseId, tableId, notificationUrl } = req.body;
      const user = req.user;

      if (!baseId || !tableId || !notificationUrl) {
        return res.status(400).json({
          success: false,
          error: 'baseId, tableId, and notificationUrl are required'
        });
      }

      // Check if user has access to the base
      const AirtableService = require('../services/airtableService');
      const bases = await AirtableService.getUserBases(user.accessToken);
      const base = bases.find(b => b.id === baseId);

      if (!base) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to base'
        });
      }

      // Create webhook specification
      const webhookSpec = {
        notificationUrl: notificationUrl,
        specification: {
          options: {
            filters: {
              dataTypes: ["tableData"]
            }
          }
        }
      };

      // Register webhook with Airtable
      const response = await require('axios').post(
        `https://api.airtable.com/v0/bases/${baseId}/webhooks`,
        webhookSpec,
        {
          headers: {
            'Authorization': `Bearer ${user.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const webhookData = response.data;

      // Store webhook info in database
      const Webhook = require('../models/Webhook');
      const webhook = new Webhook({
        userId: user.userId,
        baseId,
        tableId,
        webhookId: webhookData.id,
        macSecret: webhookData.macSecret,
        expirationTime: new Date(webhookData.expirationTime),
        notificationUrl,
        isActive: true
      });

      await webhook.save();

      res.json({
        success: true,
        webhook: webhook.toJSON(),
        message: 'Webhook registered successfully'
      });

    } catch (error) {
      logger.error('Webhook registration failed:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to register webhook',
        message: error.message
      });
    }
  }

  /**
   * List registered webhooks
   */
  async listWebhooks(req, res) {
    try {
      const user = req.user;

      const Webhook = require('../models/Webhook');
      const webhooks = await Webhook.find({
        userId: user.userId,
        isActive: true
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        webhooks
      });

    } catch (error) {
      logger.error('List webhooks failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list webhooks'
      });
    }
  }

  /**
   * Refresh webhook (renew expiration)
   */
  async refreshWebhook(req, res) {
    try {
      const { webhookId } = req.params;
      const user = req.user;

      const Webhook = require('../models/Webhook');
      const webhook = await Webhook.findOne({
        _id: webhookId,
        userId: user.userId,
        isActive: true
      });

      if (!webhook) {
        return res.status(404).json({
          success: false,
          error: 'Webhook not found'
        });
      }

      // Refresh webhook with Airtable
      const response = await require('axios').post(
        `https://api.airtable.com/v0/bases/${webhook.baseId}/webhooks/${webhook.webhookId}/refresh`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${user.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const webhookData = response.data;

      // Update webhook in database
      webhook.macSecret = webhookData.macSecret;
      webhook.expirationTime = new Date(webhookData.expirationTime);
      await webhook.save();

      res.json({
        success: true,
        webhook: webhook.toJSON(),
        message: 'Webhook refreshed successfully'
      });

    } catch (error) {
      logger.error('Webhook refresh failed:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh webhook',
        message: error.message
      });
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(req, res) {
    try {
      const { webhookId } = req.params;
      const user = req.user;

      const Webhook = require('../models/Webhook');
      const webhook = await Webhook.findOne({
        _id: webhookId,
        userId: user.userId
      });

      if (!webhook) {
        return res.status(404).json({
          success: false,
          error: 'Webhook not found'
        });
      }

      // Delete webhook from Airtable
      try {
        await require('axios').delete(
          `https://api.airtable.com/v0/bases/${webhook.baseId}/webhooks/${webhook.webhookId}`,
          {
            headers: {
              'Authorization': `Bearer ${user.accessToken}`
            }
          }
        );
      } catch (error) {
        logger.warn('Airtable webhook deletion failed:', error.message);
        // Continue anyway
      }

      // Deactivate in database
      webhook.isActive = false;
      await webhook.save();

      res.json({
        success: true,
        message: 'Webhook deleted successfully'
      });

    } catch (error) {
      logger.error('Webhook deletion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete webhook'
      });
    }
  }

  /**
   * Webhook health check endpoint
   */
  async healthCheck(req, res) {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Manual sync endpoint for testing
   */
  async manualSync(req, res) {
    try {
      const { formId } = req.params;
      const user = req.user;

      // Verify user has access to form
      const Form = require('../models/Form');
      const form = await Form.findOne({
        _id: formId,
        userId: user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // Perform manual sync
      const result = await WebhookSyncService.syncAllRecordsForForm(formId);

      res.json({
        success: true,
        ...result,
        message: 'Manual sync completed'
      });

    } catch (error) {
      logger.error('Manual sync failed:', error);
      res.status(500).json({
        success: false,
        error: 'Manual sync failed',
        message: error.message
      });
    }
  }
}

module.exports = new WebhookController();