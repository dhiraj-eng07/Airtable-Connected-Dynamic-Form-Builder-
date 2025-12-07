const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const Form = require('../models/Form');
const Response = require('../models/Response');

class AirtableService {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
    this.rateLimit = {
      remaining: 5,
      reset: 0
    };
  }

  async getUserBases(accessToken) {
    const cacheKey = `bases:${accessToken.substring(0, 20)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get('https://api.airtable.com/v0/meta/bases', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      this.updateRateLimit(response.headers);
      
      const bases = response.data.bases.map(base => ({
        id: base.id,
        name: base.name,
        permissionLevel: base.permissionLevel
      }));

      this.cache.set(cacheKey, bases);
      return bases;

    } catch (error) {
      logger.error('Failed to fetch user bases:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  async getBaseTables(accessToken, baseId) {
    const cacheKey = `tables:${baseId}:${accessToken.substring(0, 20)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      this.updateRateLimit(response.headers);
      
      const tables = response.data.tables.map(table => ({
        id: table.id,
        name: table.name,
        description: table.description || '',
        primaryFieldId: table.primaryFieldId,
        fields: table.fields.map(field => this.mapAirtableField(field))
      }));

      this.cache.set(cacheKey, tables);
      return tables;

    } catch (error) {
      logger.error('Failed to fetch base tables:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  mapAirtableField(airtableField) {
    const fieldType = airtableField.type;
    
    // Map Airtable field types to our supported types
    let mappedType;
    switch (fieldType) {
      case 'singleLineText':
      case 'email':
      case 'url':
        mappedType = 'shortText';
        break;
      case 'multilineText':
      case 'richText':
        mappedType = 'longText';
        break;
      case 'singleSelect':
        mappedType = 'singleSelect';
        break;
      case 'multipleSelects':
        mappedType = 'multiSelect';
        break;
      case 'multipleAttachments':
        mappedType = 'attachment';
        break;
      default:
        mappedType = null; // Unsupported type
    }

    const field = {
      id: airtableField.id,
      name: airtableField.name,
      description: airtableField.description || '',
      type: mappedType,
      airtableType: fieldType,
      isRequired: !airtableField.options?.isReversed, // Airtable specific
      options: []
    };

    // Add options for select fields
    if (airtableField.options && airtableField.options.choices) {
      field.options = airtableField.options.choices.map(choice => ({
        value: choice.id,
        label: choice.name,
        color: choice.color
      }));
    }

    // Add validation rules
    if (airtableField.options) {
      field.validation = {
        maxLength: airtableField.options.maxLength,
        minLength: airtableField.options.minLength,
        pattern: airtableField.options.pattern
      };
    }

    return field;
  }

  async createRecord(accessToken, baseId, tableId, recordData) {
    try {
      const response = await axios.post(
        `https://api.airtable.com/v0/${baseId}/${tableId}`,
        { fields: recordData },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.updateRateLimit(response.headers);
      
      return {
        id: response.data.id,
        createdTime: response.data.createdTime,
        fields: response.data.fields
      };

    } catch (error) {
      logger.error('Failed to create Airtable record:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  async updateRecord(accessToken, baseId, tableId, recordId, recordData) {
    try {
      const response = await axios.patch(
        `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
        { fields: recordData },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.updateRateLimit(response.headers);
      
      return {
        id: response.data.id,
        createdTime: response.data.createdTime,
        fields: response.data.fields
      };

    } catch (error) {
      logger.error('Failed to update Airtable record:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  async deleteRecord(accessToken, baseId, tableId, recordId) {
    try {
      const response = await axios.delete(
        `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      this.updateRateLimit(response.headers);
      return true;

    } catch (error) {
      logger.error('Failed to delete Airtable record:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  async getRecord(accessToken, baseId, tableId, recordId) {
    try {
      const response = await axios.get(
        `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      this.updateRateLimit(response.headers);
      return response.data;

    } catch (error) {
      logger.error('Failed to get Airtable record:', error.response?.data || error.message);
      throw this.handleAirtableError(error);
    }
  }

  async syncResponseToAirtable(responseId) {
    const response = await Response.findById(responseId).populate('formId');
    
    if (!response || response.status === 'deleted') {
      throw new Error('Response not found or deleted');
    }

    const form = response.formId;
    const user = await require('../models/User').findById(form.userId);
    
    if (!user || user.isTokenExpired()) {
      throw new Error('User token expired or not found');
    }

    try {
      // Convert answers to Airtable fields format
      const airtableFields = {};
      response.answers.forEach(answer => {
        const question = form.getQuestion(answer.questionKey);
        if (question) {
          airtableFields[question.airtableFieldId] = answer.value;
        }
      });

      let airtableRecord;
      
      if (response.status === 'submitted' || response.status === 'failed') {
        // Create new record
        airtableRecord = await this.createRecord(
          user.accessToken,
          form.airtableBaseId,
          form.airtableTableId,
          airtableFields
        );
        
        response.airtableRecordId = airtableRecord.id;
      } else {
        // Update existing record
        airtableRecord = await this.updateRecord(
          user.accessToken,
          form.airtableBaseId,
          form.airtableTableId,
          response.airtableRecordId,
          airtableFields
        );
      }

      await response.updateSyncStatus(true);
      logger.info(`Successfully synced response ${responseId} to Airtable`);
      
      return airtableRecord;

    } catch (error) {
      await response.updateSyncStatus(false, error.message);
      logger.error(`Failed to sync response ${responseId} to Airtable:`, error);
      throw error;
    }
  }

  updateRateLimit(headers) {
    if (headers['ratelimit-remaining']) {
      this.rateLimit.remaining = parseInt(headers['ratelimit-remaining']);
    }
    if (headers['ratelimit-reset']) {
      this.rateLimit.reset = parseInt(headers['ratelimit-reset']);
    }
  }

  handleAirtableError(error) {
    if (error.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          return new Error('Airtable authentication failed. Please reconnect your account.');
        case 403:
          return new Error('Permission denied. Check your Airtable API permissions.');
        case 404:
          return new Error('Resource not found in Airtable.');
        case 429:
          return new Error('Rate limit exceeded. Please try again later.');
        case 422:
          return new Error(`Validation error: ${data.error?.message || 'Invalid data'}`);
        default:
          return new Error(`Airtable API error: ${data.error?.message || 'Unknown error'}`);
      }
    }
    
    return error;
  }

  clearCacheForUser(accessToken) {
    const prefix = accessToken.substring(0, 20);
    const keys = this.cache.keys();
    keys.forEach(key => {
      if (key.startsWith(`bases:${prefix}`) || key.startsWith(`tables:${prefix}`)) {
        this.cache.del(key);
      }
    });
  }
}

module.exports = new AirtableService();