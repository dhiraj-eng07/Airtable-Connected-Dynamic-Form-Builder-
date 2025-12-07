const crypto = require('crypto');
const Response = require('../models/Response');
const Form = require('../models/Form');
const AirtableService = require('./airtableService');
const logger = require('../utils/logger');

class WebhookSyncService {
  constructor() {
    this.webhookSecret = process.env.WEBHOOK_SECRET;
    this.batchSize = 10;
    this.maxRetries = 3;
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload, signature) {
    if (!this.webhookSecret) {
      logger.warn('WEBHOOK_SECRET not set, skipping signature verification');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Process webhook payload from Airtable
   */
  async processWebhook(payload) {
    try {
      const { base, webhook } = payload;
      
      if (!base || !webhook) {
        throw new Error('Invalid webhook payload');
      }

      logger.info(`Processing webhook for base ${base.id}, action: ${webhook.action}`);

      switch (webhook.action) {
        case 'updatedRecords':
          await this.handleUpdatedRecords(base.id, webhook);
          break;
          
        case 'createdRecords':
          await this.handleCreatedRecords(base.id, webhook);
          break;
          
        case 'deletedRecords':
          await this.handleDeletedRecords(base.id, webhook);
          break;
          
        default:
          logger.warn(`Unhandled webhook action: ${webhook.action}`);
      }

      logger.info(`Webhook processing completed for base ${base.id}`);
      return { success: true };

    } catch (error) {
      logger.error('Webhook processing failed:', error);
      throw error;
    }
  }

  /**
   * Handle updated records
   */
  async handleUpdatedRecords(baseId, webhook) {
    const { tableId, recordIds } = webhook;
    
    if (!tableId || !recordIds || !Array.isArray(recordIds)) {
      throw new Error('Invalid updated records payload');
    }

    // Find forms for this base and table
    const forms = await Form.find({
      airtableBaseId: baseId,
      airtableTableId: tableId,
      isActive: true
    });

    if (forms.length === 0) {
      logger.warn(`No active forms found for base ${baseId}, table ${tableId}`);
      return;
    }

    // Process records in batches
    for (let i = 0; i < recordIds.length; i += this.batchSize) {
      const batch = recordIds.slice(i, i + this.batchSize);
      
      await Promise.all(
        batch.map(recordId => this.syncSingleRecord(baseId, tableId, recordId))
      );
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Handle created records
   */
  async handleCreatedRecords(baseId, webhook) {
    // Similar to updated records, but we might want to create new responses
    await this.handleUpdatedRecords(baseId, webhook);
  }

  /**
   * Handle deleted records
   */
  async handleDeletedRecords(baseId, webhook) {
    const { tableId, recordIds } = webhook;
    
    if (!tableId || !recordIds || !Array.isArray(recordIds)) {
      throw new Error('Invalid deleted records payload');
    }

    // Mark responses as deleted in our database
    for (const recordId of recordIds) {
      try {
        const response = await Response.markAsDeleted(recordId);
        if (response) {
          logger.info(`Marked response for record ${recordId} as deleted`);
        }
      } catch (error) {
        logger.error(`Failed to mark record ${recordId} as deleted:`, error);
      }
    }
  }

  /**
   * Sync a single record from Airtable to our database
   */
  async syncSingleRecord(baseId, tableId, recordId) {
    try {
      // Find the form for this table
      const form = await Form.findOne({
        airtableBaseId: baseId,
        airtableTableId: tableId,
        isActive: true
      });

      if (!form) {
        logger.warn(`No form found for base ${baseId}, table ${tableId}`);
        return;
      }

      // Get user to access Airtable API
      const user = await require('../models/User').findById(form.userId);
      if (!user || user.isTokenExpired()) {
        logger.warn(`User ${form.userId} token expired for record sync`);
        return;
      }

      // Fetch record from Airtable
      const airtableRecord = await AirtableService.getRecord(
        user.accessToken,
        baseId,
        tableId,
        recordId
      );

      if (!airtableRecord) {
        logger.warn(`Record ${recordId} not found in Airtable`);
        return;
      }

      // Convert Airtable fields to our response format
      const answers = [];
      form.questions.forEach(question => {
        const fieldValue = airtableRecord.fields[question.airtableFieldId];
        if (fieldValue !== undefined) {
          answers.push({
            questionKey: question.questionKey,
            value: fieldValue,
            submittedAt: new Date()
          });
        }
      });

      // Find or create response
      let response = await Response.findOne({ airtableRecordId: recordId });
      
      if (response) {
        // Update existing response
        response.answers = answers;
        response.status = 'synced';
        response.syncStatus.lastSyncedAt = new Date();
        response.syncStatus.syncAttempts += 1;
      } else {
        // Create new response
        response = new Response({
          formId: form._id,
          userId: form.userId,
          airtableRecordId: recordId,
          status: 'synced',
          answers: answers,
          syncStatus: {
            lastSyncedAt: new Date(),
            syncAttempts: 1
          }
        });
      }

      await response.save();
      logger.info(`Synced record ${recordId} to database`);

    } catch (error) {
      logger.error(`Failed to sync record ${recordId}:`, error);
      
      // Update response status if it exists
      try {
        const response = await Response.findOne({ airtableRecordId: recordId });
        if (response) {
          response.status = 'failed';
          response.syncStatus.syncError = error.message;
          response.syncStatus.syncAttempts += 1;
          await response.save();
        }
      } catch (dbError) {
        logger.error(`Failed to update error status for record ${recordId}:`, dbError);
      }
    }
  }

  /**
   * Sync all records for a form
   */
  async syncAllRecordsForForm(formId) {
    try {
      const form = await Form.findById(formId);
      if (!form) {
        throw new Error('Form not found');
      }

      const user = await require('../models/User').findById(form.userId);
      if (!user || user.isTokenExpired()) {
        throw new Error('User token expired');
      }

      logger.info(`Starting full sync for form ${formId}`);
      
      let offset = null;
      let syncedCount = 0;
      let errorCount = 0;

      do {
        try {
          // Fetch records from Airtable with pagination
          const url = `https://api.airtable.com/v0/${form.airtableBaseId}/${form.airtableTableId}`;
          const params = offset ? { offset } : {};
          
          const response = await require('axios').get(url, {
            headers: {
              'Authorization': `Bearer ${user.accessToken}`
            },
            params
          });

          const { records, offset: nextOffset } = response.data;
          
          // Process each record
          for (const record of records) {
            try {
              await this.syncSingleRecord(
                form.airtableBaseId,
                form.airtableTableId,
                record.id
              );
              syncedCount++;
            } catch (recordError) {
              logger.error(`Failed to sync record ${record.id}:`, recordError);
              errorCount++;
            }
          }

          offset = nextOffset;
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (batchError) {
          logger.error('Batch sync failed:', batchError);
          errorCount++;
          break;
        }
      } while (offset);

      logger.info(`Full sync completed for form ${formId}: ${syncedCount} synced, ${errorCount} errors`);

      return {
        success: true,
        syncedCount,
        errorCount
      };

    } catch (error) {
      logger.error(`Full sync failed for form ${formId}:`, error);
      throw error;
    }
  }

  /**
   * Retry failed syncs
   */
  async retryFailedSyncs(limit = 100) {
    try {
      const failedResponses = await Response.find({
        status: 'failed',
        'syncStatus.syncAttempts': { $lt: this.maxRetries }
      }).limit(limit);

      logger.info(`Retrying ${failedResponses.length} failed syncs`);

      const results = {
        success: 0,
        failed: 0
      };

      for (const response of failedResponses) {
        try {
          const form = await Form.findById(response.formId);
          if (!form) continue;

          const user = await require('../models/User').findById(form.userId);
          if (!user || user.isTokenExpired()) continue;

          await AirtableService.syncResponseToAirtable(response._id);
          results.success++;
        } catch (error) {
          logger.error(`Retry failed for response ${response._id}:`, error);
          results.failed++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.info(`Retry completed: ${results.success} succeeded, ${results.failed} failed`);
      
      return results;

    } catch (error) {
      logger.error('Retry failed syncs operation failed:', error);
      throw error;
    }
  }
}

module.exports = new WebhookSyncService();