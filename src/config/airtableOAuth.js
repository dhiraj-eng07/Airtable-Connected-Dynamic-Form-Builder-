const crypto = require('crypto');

class AirtableOAuthConfig {
  constructor() {
    this.validateConfig();
  }

  validateConfig() {
    const required = [
      'AIRTABLE_CLIENT_ID',
      'AIRTABLE_CLIENT_SECRET',
      'AIRTABLE_REDIRECT_URI',
      'AIRTABLE_SCOPE'
    ];

    required.forEach(key => {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    });
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.AIRTABLE_CLIENT_ID,
      redirect_uri: process.env.AIRTABLE_REDIRECT_URI,
      scope: process.env.AIRTABLE_SCOPE,
      state: state || this.generateState(),
      response_type: 'code'
    });

    return `https://airtable.com/oauth2/v1/authorize?${params.toString()}`;
  }

  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

  getTokenUrl() {
    return 'https://airtable.com/oauth2/v1/token';
  }

  getRevokeUrl() {
    return 'https://airtable.com/oauth2/v1/revoke';
  }

  getClientCredentials() {
    return {
      client_id: process.env.AIRTABLE_CLIENT_ID,
      client_secret: process.env.AIRTABLE_CLIENT_SECRET,
      redirect_uri: process.env.AIRTABLE_REDIRECT_URI
    };
  }

  getApiHeaders(accessToken) {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  getBaseUrl(baseId) {
    return `https://api.airtable.com/v0/${baseId}`;
  }
}

module.exports = new AirtableOAuthConfig();