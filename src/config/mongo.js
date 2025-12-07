const mongoose = require('mongoose');
const logger = require('../utils/logger');

class DatabaseManager {
  constructor() {
    this.connection = null;
    this.isConnecting = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

async connect() {
  try {
    // Use MongoDB Atlas if available, otherwise local MongoDB
    const uri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI;
    
    if (!uri) {
      throw new Error('MongoDB connection URI is not defined in environment variables');
    }

    console.log(`Connecting to MongoDB: ${uri.split('@')[1]?.split('/')[0] || 'Local MongoDB'}`);
    
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    };

    await mongoose.connect(uri, options);
    
    console.log(`✅ MongoDB connected successfully to database: "${mongoose.connection.name}"`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected successfully');
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('Attempting to connect to local MongoDB as fallback...');
    
    // Try local MongoDB as fallback
    try {
      const localUri = process.env.MONGODB_URI;
      if (localUri && localUri !== uri) {
        await mongoose.connect(localUri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000
        });
        console.log('✅ Connected to local MongoDB as fallback');
      } else {
        throw error;
      }
    } catch (fallbackError) {
      console.error('❌ Both Atlas and local MongoDB connections failed');
      throw fallbackError;
    }
  }
}
  handleConnectionError() {
    if (this.connection && this.connection.readyState === 1) {
      return;
    }
    
    setTimeout(() => {
      if (this.connection.readyState !== 1) {
        this.connect().catch(error => {
          logger.error('Failed to reconnect to MongoDB:', error);
        });
      }
    }, 5000);
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      this.connection = null;
      logger.info('MongoDB disconnected');
    }
  }
}

const dbManager = new DatabaseManager();

module.exports = dbManager.connect.bind(dbManager);