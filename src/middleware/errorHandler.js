'use strict';
const logger = require('../utils/logger');

/* ── Custom Error Class ───────────────────────────────────── */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/* ── Async handler (eliminates try/catch in routes) ─────── */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ── 404 handler ─────────────────────────────────────────── */
const notFound = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
};

/* ── Global error handler ────────────────────────────────── */
const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status     = err.status || 'error';

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    err = new AppError('Invalid resource ID', 400);
  }
  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    err = new AppError(`${field} already exists`, 409);
  }
  // Mongoose validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join('. ');
    err = new AppError(messages, 400);
  }
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    err = new AppError('Invalid token. Please log in again.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    err = new AppError('Your session has expired. Please log in again.', 401);
  }

  // Log server errors
  if (err.statusCode >= 500) {
    logger.error(`[${req.method}] ${req.path} — ${err.message}`, { stack: err.stack });
  }

  res.status(err.statusCode).json({
    status:  err.status,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { AppError, asyncHandler, notFound, globalErrorHandler };
