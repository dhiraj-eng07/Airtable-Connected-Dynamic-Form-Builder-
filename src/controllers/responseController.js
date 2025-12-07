const Response = require('../models/Response');
const Form = require('../models/Form');
const AirtableService = require('../services/airtableService');
const ConditionalLogic = require('../services/conditionalLogic');
const FormValidator = require('../services/formValidation');
const logger = require('../utils/logger');

class ResponseController {
  /**
   * Submit form response
   */
  async submitResponse(req, res) {
    try {
      const { formId } = req.params;
      const { answers, metadata } = req.body;

      // Get form
      const form = await Form.findOne({
        _id: formId,
        isActive: true,
        publishedAt: { $ne: null }
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found or not published'
        });
      }

      // Validate answers against form definition
      const validationErrors = [];
      const processedAnswers = [];

      // Check required fields
      form.questions.forEach(question => {
        if (question.required) {
          const answer = answers[question.questionKey];
          if (answer === undefined || answer === null || answer === '') {
            validationErrors.push({
              questionKey: question.questionKey,
              error: 'This field is required'
            });
          }
        }
      });

      // Validate each answer
      Object.entries(answers).forEach(([questionKey, value]) => {
        const question = form.getQuestion(questionKey);
        
        if (!question) {
          validationErrors.push({
            questionKey,
            error: 'Question not found in form'
          });
          return;
        }

        const validation = form.validateAnswer(questionKey, value);
        if (!validation.isValid) {
          validationErrors.push({
            questionKey,
            error: validation.error
          });
          return;
        }

        // Apply conditional logic
        if (question.conditionalRules) {
          const shouldShow = ConditionalLogic.shouldShowQuestion(
            question.conditionalRules,
            answers
          );
          
          if (!shouldShow) {
            // Question shouldn't be visible, skip it
            return;
          }
        }

        processedAnswers.push({
          questionKey,
          value,
          submittedAt: new Date()
        });
      });

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationErrors
        });
      }

      // Get user for Airtable sync
      const user = await require('../models/User').findById(form.userId);
      
      let airtableRecordId = null;
      let syncError = null;

      try {
        // Prepare data for Airtable
        const airtableFields = {};
        processedAnswers.forEach(answer => {
          const question = form.getQuestion(answer.questionKey);
          if (question) {
            airtableFields[question.airtableFieldId] = answer.value;
          }
        });

        // Create record in Airtable
        const airtableRecord = await AirtableService.createRecord(
          user.accessToken,
          form.airtableBaseId,
          form.airtableTableId,
          airtableFields
        );

        airtableRecordId = airtableRecord.id;

      } catch (airtableError) {
        logger.error('Airtable submission failed:', airtableError);
        syncError = airtableError.message;
        // Continue to save response locally even if Airtable fails
      }

      // Create response in database
      const response = new Response({
        formId: form._id,
        userId: form.userId,
        airtableRecordId: airtableRecordId || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: airtableRecordId ? 'submitted' : 'failed',
        answers: processedAnswers,
        submittedBy: {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          referrer: req.get('Referer')
        },
        syncStatus: {
          lastSyncedAt: airtableRecordId ? new Date() : null,
          syncAttempts: 1,
          syncError
        },
        metadata: metadata || {}
      });

      await response.save();

      // If Airtable submission failed, queue for retry
      if (!airtableRecordId) {
        // You might want to queue this for background retry
        logger.warn(`Response ${response._id} saved locally but Airtable submission failed`);
      }

      res.status(201).json({
        success: true,
        response: response.toJSON(),
        message: 'Response submitted successfully'
      });

    } catch (error) {
      logger.error('Submit response failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit response',
        message: error.message
      });
    }
  }

  /**
   * Get responses for a form
   */
  async getFormResponses(req, res) {
    try {
      const { formId } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        status,
        startDate,
        endDate,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      const skip = (page - 1) * limit;

      // Verify user has access to this form
      const form = await Form.findOne({
        _id: formId,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // Build query
      const query = { formId: form._id };
      
      if (status) {
        query.status = status;
      }
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          query.createdAt.$lte = new Date(endDate);
        }
      }

      // Get responses
      const responses = await Response.find(query)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-answers.files -submittedBy -metadata -syncStatus');

      const total = await Response.countDocuments(query);

      // Get response statistics
      const stats = await Response.aggregate([
        { $match: { formId: form._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statsMap = stats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});

      res.json({
        success: true,
        responses,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        stats: {
          total,
          byStatus: statsMap
        }
      });

    } catch (error) {
      logger.error('Get form responses failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch responses'
      });
    }
  }

  /**
   * Get single response
   */
  async getResponse(req, res) {
    try {
      const { responseId } = req.params;

      const response = await Response.findById(responseId)
        .populate('formId', 'title questions');

      if (!response) {
        return res.status(404).json({
          success: false,
          error: 'Response not found'
        });
      }

      // Verify user has access
      const form = await Form.findOne({
        _id: response.formId._id,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      // Enrich response with question details
      const enrichedAnswers = response.answers.map(answer => {
        const question = form.questions.find(q => q.questionKey === answer.questionKey);
        return {
          ...answer.toObject(),
          question: question ? {
            label: question.label,
            type: question.type,
            required: question.required
          } : null
        };
      });

      const enrichedResponse = response.toObject();
      enrichedResponse.answers = enrichedAnswers;

      res.json({
        success: true,
        response: enrichedResponse
      });

    } catch (error) {
      logger.error('Get response failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch response'
      });
    }
  }

  /**
   * Update response (for syncing with Airtable)
   */
  async updateResponse(req, res) {
    try {
      const { responseId } = req.params;
      const updates = req.body;

      const response = await Response.findById(responseId);
      
      if (!response) {
        return res.status(404).json({
          success: false,
          error: 'Response not found'
        });
      }

      // Verify user has access
      const form = await Form.findOne({
        _id: response.formId,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      // Validate updates if answers are being modified
      if (updates.answers) {
        const validationErrors = [];
        
        updates.answers.forEach(update => {
          const question = form.getQuestion(update.questionKey);
          if (question) {
            const validation = form.validateAnswer(update.questionKey, update.value);
            if (!validation.isValid) {
              validationErrors.push({
                questionKey: update.questionKey,
                error: validation.error
              });
            }
          }
        });

        if (validationErrors.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: validationErrors
          });
        }

        // Update answers
        response.answers = updates.answers.map(update => ({
          questionKey: update.questionKey,
          value: update.value,
          submittedAt: new Date()
        }));
      }

      // Update other fields
      if (updates.status) {
        response.status = updates.status;
      }
      
      if (updates.syncStatus) {
        response.syncStatus = {
          ...response.syncStatus,
          ...updates.syncStatus,
          lastSyncedAt: new Date()
        };
      }

      await response.save();

      res.json({
        success: true,
        response: response.toJSON(),
        message: 'Response updated successfully'
      });

    } catch (error) {
      logger.error('Update response failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update response',
        message: error.message
      });
    }
  }

  /**
   * Delete response (soft delete)
   */
  async deleteResponse(req, res) {
    try {
      const { responseId } = req.params;

      const response = await Response.findById(responseId);
      
      if (!response) {
        return res.status(404).json({
          success: false,
          error: 'Response not found'
        });
      }

      // Verify user has access
      const form = await Form.findOne({
        _id: response.formId,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      // Mark as deleted
      response.status = 'deleted';
      response.syncStatus.lastSyncedAt = new Date();
      await response.save();

      // Also delete from Airtable if requested
      if (req.query.deleteFromAirtable === 'true') {
        try {
          const user = await require('../models/User').findById(form.userId);
          if (user && !user.isTokenExpired()) {
            await AirtableService.deleteRecord(
              user.accessToken,
              form.airtableBaseId,
              form.airtableTableId,
              response.airtableRecordId
            );
          }
        } catch (airtableError) {
          logger.warn('Failed to delete from Airtable:', airtableError);
          // Continue anyway
        }
      }

      res.json({
        success: true,
        message: 'Response deleted successfully'
      });

    } catch (error) {
      logger.error('Delete response failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete response'
      });
    }
  }

  /**
   * Export responses as CSV
   */
  async exportResponses(req, res) {
    try {
      const { formId } = req.params;
      const { format = 'csv', startDate, endDate } = req.query;

      // Verify user has access
      const form = await Form.findOne({
        _id: formId,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // Build query
      const query = { formId: form._id, status: { $ne: 'deleted' } };
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          query.createdAt.$lte = new Date(endDate);
        }
      }

      // Get all responses
      const responses = await Response.find(query)
        .sort({ createdAt: -1 })
        .select('answers createdAt status');

      if (format === 'csv') {
        // Generate CSV
        const headers = ['Timestamp', 'Status'];
        const questionColumns = form.questions.map(q => q.label);
        headers.push(...questionColumns);

        const rows = responses.map(response => {
          const row = [
            response.createdAt.toISOString(),
            response.status
          ];

          // Add answers in the same order as questions
          form.questions.forEach(question => {
            const answer = response.answers.find(a => a.questionKey === question.questionKey);
            row.push(answer ? this.formatValueForExport(answer.value) : '');
          });

          return row;
        });

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => this.escapeCsvCell(cell)).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="responses_${formId}_${Date.now()}.csv"`);
        return res.send(csvContent);

      } else if (format === 'json') {
        // Return JSON
        const exportData = responses.map(response => ({
          id: response._id,
          timestamp: response.createdAt,
          status: response.status,
          answers: response.answers.reduce((acc, answer) => {
            const question = form.questions.find(q => q.questionKey === answer.questionKey);
            acc[question ? question.label : answer.questionKey] = answer.value;
            return acc;
          }, {})
        }));

        res.json({
          success: true,
          form: {
            id: form._id,
            title: form.title,
            description: form.description
          },
          responses: exportData,
          count: responses.length,
          exportedAt: new Date().toISOString()
        });

      } else {
        return res.status(400).json({
          success: false,
          error: 'Unsupported export format. Use "csv" or "json".'
        });
      }

    } catch (error) {
      logger.error('Export responses failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export responses',
        message: error.message
      });
    }
  }

  /**
   * Sync response with Airtable
   */
  async syncResponse(req, res) {
    try {
      const { responseId } = req.params;

      const response = await Response.findById(responseId);
      
      if (!response) {
        return res.status(404).json({
          success: false,
          error: 'Response not found'
        });
      }

      // Verify user has access
      const form = await Form.findOne({
        _id: response.formId,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      // Sync with Airtable
      const airtableRecord = await AirtableService.syncResponseToAirtable(responseId);

      res.json({
        success: true,
        response: response.toJSON(),
        airtableRecord,
        message: 'Response synced successfully'
      });

    } catch (error) {
      logger.error('Sync response failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to sync response',
        message: error.message
      });
    }
  }

  /**
   * Helper: Format value for CSV export
   */
  formatValueForExport(value) {
    if (value === null || value === undefined) {
      return '';
    }
    
    if (Array.isArray(value)) {
      return value.join('; ');
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  }

  /**
   * Helper: Escape CSV cell
   */
  escapeCsvCell(cell) {
    if (cell === null || cell === undefined) {
      return '';
    }
    
    const stringCell = String(cell);
    
    if (stringCell.includes(',') || stringCell.includes('"') || stringCell.includes('\n')) {
      return `"${stringCell.replace(/"/g, '""')}"`;
    }
    
    return stringCell;
  }
}

module.exports = new ResponseController();