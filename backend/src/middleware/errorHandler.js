'use strict';

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
};

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status     = err.status     || 'error';

  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status:  err.status,
      message: err.message,
      stack:   err.stack,
    });
  }

  // Production — don't leak stack traces
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status:  err.status,
      message: err.message,
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({ status:'fail', message:`${field} already exists.` });
  }

  // Mongoose validation
  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map(e => e.message).join('. ');
    return res.status(400).json({ status:'fail', message: msg });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError')  return res.status(401).json({ status:'fail', message:'Invalid token.' });
  if (err.name === 'TokenExpiredError')  return res.status(401).json({ status:'fail', message:'Token expired.' });

  // Unknown — generic
  console.error('UNHANDLED ERROR:', err);
  res.status(500).json({ status:'error', message:'Something went wrong.' });
};

module.exports = { AppError, asyncHandler, notFound, globalErrorHandler };
