const Form = require('../models/Form');
const AirtableService = require('../services/airtableService');
const ConditionalLogic = require('../services/conditionalLogic');
const FormValidator = require('../services/formValidation');
const logger = require('../utils/logger');

class FormController {
  /**
   * Get all forms for current user
   */
  async getUserForms(req, res) {
    try {
      const { page = 1, limit = 20, search } = req.query;
      const skip = (page - 1) * limit;

      const query = { userId: req.user.userId, isActive: true };
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      const forms = await Form.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-questions.conditionalRules -questions.options');

      const total = await Form.countDocuments(query);

      res.json({
        success: true,
        forms,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get user forms failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch forms'
      });
    }
  }

  /**
   * Create a new form
   */
  async createForm(req, res) {
    try {
      const {
        title,
        description,
        airtableBaseId,
        airtableTableId,
        questions,
        settings
      } = req.body;

      // Validate required fields
      if (!title || !airtableBaseId || !airtableTableId || !questions) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      // Get user to access Airtable API
      const user = await require('../models/User').findById(req.user.userId);
      if (!user || user.isTokenExpired()) {
        return res.status(401).json({
          success: false,
          error: 'User token expired, please reauthenticate'
        });
      }

      // Fetch table details from Airtable to validate
      const tables = await AirtableService.getBaseTables(user.accessToken, airtableBaseId);
      const table = tables.find(t => t.id === airtableTableId);
      
      if (!table) {
        return res.status(404).json({
          success: false,
          error: 'Table not found in Airtable'
        });
      }

      // Validate questions against Airtable fields
      const validationResult = FormValidator.validateQuestions(questions, table.fields);
      
      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid questions configuration',
          details: validationResult.errors
        });
      }

      // Validate conditional logic
      const conditionalErrors = [];
      questions.forEach((question, index) => {
        if (question.conditionalRules) {
          const availableKeys = questions.map(q => q.questionKey);
          const validation = ConditionalLogic.validateRules(question.conditionalRules, availableKeys);
          
          if (!validation.valid) {
            conditionalErrors.push({
              questionIndex: index,
              questionKey: question.questionKey,
              errors: validation.errors
            });
          }
        }
      });

      if (conditionalErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid conditional logic',
          details: conditionalErrors
        });
      }

      // Check for circular dependencies
      const circularCheck = ConditionalLogic.detectCircularDependencies(questions);
      if (circularCheck.hasCycles) {
        return res.status(400).json({
          success: false,
          error: 'Circular dependency detected in conditional logic',
          cycles: circularCheck.cycles
        });
      }

      // Create form
      const form = new Form({
        userId: req.user.userId,
        title,
        description: description || '',
        airtableBaseId,
        airtableTableId,
        airtableTableName: table.name,
        questions: questions.map((q, index) => ({
          ...q,
          order: index
        })),
        settings: settings || {},
        publishedAt: new Date()
      });

      await form.save();

      res.status(201).json({
        success: true,
        form: form.toJSON()
      });

    } catch (error) {
      logger.error('Create form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create form',
        message: error.message
      });
    }
  }

  /**
   * Get form by ID
   */
  async getForm(req, res) {
    try {
      const { id } = req.params;
      
      const form = await Form.findOne({
        _id: id,
        isActive: true,
        $or: [
          { userId: req.user.userId },
          { publishedAt: { $ne: null } }
        ]
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // If user is not the owner and form is not published
      if (!form.userId.equals(req.user.userId) && !form.publishedAt) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      res.json({
        success: true,
        form: form.toJSON()
      });

    } catch (error) {
      logger.error('Get form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch form'
      });
    }
  }

  /**
   * Update form
   */
  async updateForm(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const form = await Form.findOne({
        _id: id,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // Validate updates if questions are being modified
      if (updates.questions) {
        // Get user for Airtable access
        const user = await require('../models/User').findById(req.user.userId);
        if (!user || user.isTokenExpired()) {
          return res.status(401).json({
            success: false,
            error: 'User token expired'
          });
        }

        // Fetch table details
        const tables = await AirtableService.getBaseTables(user.accessToken, form.airtableBaseId);
        const table = tables.find(t => t.id === form.airtableTableId);
        
        if (!table) {
          return res.status(404).json({
            success: false,
            error: 'Table not found in Airtable'
          });
        }

        // Validate questions
        const validationResult = FormValidator.validateQuestions(updates.questions, table.fields);
        
        if (!validationResult.valid) {
          return res.status(400).json({
            success: false,
            error: 'Invalid questions configuration',
            details: validationResult.errors
          });
        }

        // Validate conditional logic
        const availableKeys = updates.questions.map(q => q.questionKey);
        const conditionalErrors = [];
        
        updates.questions.forEach((question, index) => {
          if (question.conditionalRules) {
            const validation = ConditionalLogic.validateRules(question.conditionalRules, availableKeys);
            
            if (!validation.valid) {
              conditionalErrors.push({
                questionIndex: index,
                questionKey: question.questionKey,
                errors: validation.errors
              });
            }
          }
        });

        if (conditionalErrors.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid conditional logic',
            details: conditionalErrors
          });
        }

        // Check for circular dependencies
        const circularCheck = ConditionalLogic.detectCircularDependencies(updates.questions);
        if (circularCheck.hasCycles) {
          return res.status(400).json({
            success: false,
            error: 'Circular dependency detected in conditional logic',
            cycles: circularCheck.cycles
          });
        }

        // Update questions with order
        updates.questions = updates.questions.map((q, index) => ({
          ...q,
          order: index
        }));
      }

      // Apply updates
      Object.keys(updates).forEach(key => {
        if (key !== '_id' && key !== '__v') {
          form[key] = updates[key];
        }
      });

      form.version += 1;
      await form.save();

      res.json({
        success: true,
        form: form.toJSON()
      });

    } catch (error) {
      logger.error('Update form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update form',
        message: error.message
      });
    }
  }

  /**
   * Delete form (soft delete)
   */
  async deleteForm(req, res) {
    try {
      const { id } = req.params;

      const form = await Form.findOneAndUpdate(
        {
          _id: id,
          userId: req.user.userId,
          isActive: true
        },
        {
          isActive: false,
          publishedAt: null
        },
        { new: true }
      );

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      res.json({
        success: true,
        message: 'Form deleted successfully'
      });

    } catch (error) {
      logger.error('Delete form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete form'
      });
    }
  }

  /**
   * Publish form
   */
  async publishForm(req, res) {
    try {
      const { id } = req.params;

      const form = await Form.findOneAndUpdate(
        {
          _id: id,
          userId: req.user.userId,
          isActive: true
        },
        {
          publishedAt: new Date()
        },
        { new: true }
      );

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      res.json({
        success: true,
        form: form.toJSON(),
        message: 'Form published successfully'
      });

    } catch (error) {
      logger.error('Publish form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to publish form'
      });
    }
  }

  /**
   * Unpublish form
   */
  async unpublishForm(req, res) {
    try {
      const { id } = req.params;

      const form = await Form.findOneAndUpdate(
        {
          _id: id,
          userId: req.user.userId,
          isActive: true
        },
        {
          publishedAt: null
        },
        { new: true }
      );

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      res.json({
        success: true,
        form: form.toJSON(),
        message: 'Form unpublished successfully'
      });

    } catch (error) {
      logger.error('Unpublish form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unpublish form'
      });
    }
  }

  /**
   * Get form for public viewing (no authentication required)
   */
  async getPublicForm(req, res) {
    try {
      const { id } = req.params;
      
      const form = await Form.findOne({
        _id: id,
        isActive: true,
        publishedAt: { $ne: null }
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found or not published'
        });
      }

      // Return minimal data for public viewing
      const publicForm = {
        id: form._id,
        title: form.title,
        description: form.description,
        questions: form.questions.map(q => ({
          questionKey: q.questionKey,
          label: q.label,
          type: q.type,
          required: q.required,
          placeholder: q.placeholder,
          helpText: q.helpText,
          options: q.options,
          validationRules: q.validationRules,
          order: q.order
        })),
        settings: form.settings,
        createdAt: form.createdAt
      };

      res.json({
        success: true,
        form: publicForm
      });

    } catch (error) {
      logger.error('Get public form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch form'
      });
    }
  }

  /**
   * Duplicate form
   */
  async duplicateForm(req, res) {
    try {
      const { id } = req.params;
      const { title } = req.body;

      const originalForm = await Form.findOne({
        _id: id,
        userId: req.user.userId,
        isActive: true
      });

      if (!originalForm) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      // Create duplicate
      const duplicateForm = new Form({
        userId: req.user.userId,
        title: title || `${originalForm.title} (Copy)`,
        description: originalForm.description,
        airtableBaseId: originalForm.airtableBaseId,
        airtableTableId: originalForm.airtableTableId,
        airtableTableName: originalForm.airtableTableName,
        questions: originalForm.questions.map(q => ({
          ...q.toObject(),
          _id: undefined
        })),
        settings: originalForm.settings,
        version: 1
      });

      await duplicateForm.save();

      res.status(201).json({
        success: true,
        form: duplicateForm.toJSON(),
        message: 'Form duplicated successfully'
      });

    } catch (error) {
      logger.error('Duplicate form failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to duplicate form'
      });
    }
  }

  /**
   * Get form statistics
   */
  async getFormStats(req, res) {
    try {
      const { id } = req.params;

      const form = await Form.findOne({
        _id: id,
        userId: req.user.userId,
        isActive: true
      });

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found'
        });
      }

      const Response = require('../models/Response');
      const stats = await Response.getStats(id);

      res.json({
        success: true,
        stats: {
          total: Object.values(stats).reduce((sum, s) => sum + s.count, 0),
          byStatus: stats,
          questions: form.questions.length,
          published: !!form.publishedAt
        }
      });

    } catch (error) {
      logger.error('Get form stats failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get form statistics'
      });
    }
  }
}

module.exports = new FormController();