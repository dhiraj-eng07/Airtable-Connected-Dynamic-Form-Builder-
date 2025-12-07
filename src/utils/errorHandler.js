// custom errors
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const errorHandler = {
  notFound: (message) => new AppError(message || 'Not Found', 404),
  badRequest: (message) => new AppError(message || 'Bad Request', 400),
  unauthorized: (message) => new AppError(message || 'Unauthorized', 401),
  forbidden: (message) => new AppError(message || 'Forbidden', 403),
  serverError: (message) => new AppError(message || 'Server Error', 500),
};

module.exports = { AppError, errorHandler };
