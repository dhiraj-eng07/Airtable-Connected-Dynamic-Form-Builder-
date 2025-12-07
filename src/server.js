const http = require('http');
const app = require('./app');
const connectDB = require('./config/mongo');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

async function initializeServer() {
  try {
    await connectDB();
    
    const server = http.createServer(app);
    
    server.listen(PORT, () => {
      logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });

    process.on('unhandledRejection', (error) => {
      logger.error('Unhandled Rejection:', error);
      process.exit(1);
    });

  } catch (error) {
    logger.error('Server initialization failed:', error);
    process.exit(1);
  }
}

initializeServer();