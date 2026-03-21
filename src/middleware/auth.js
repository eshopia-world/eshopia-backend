'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { AppError, asyncHandler } = require('./errorHandler');

/* ── Verify JWT and attach user to req ───────────────────── */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Not authenticated. Please log in.', 401));
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select('-password');

  if (!user) {
    return next(new AppError('User no longer exists.', 401));
  }
  if (user.isBanned) {
    return next(new AppError('Your account has been suspended.', 403));
  }

  req.user = user;
  next();
});

/* ── Role-based access control ───────────────────────────── */
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission for this action.', 403));
  }
  next();
};

/* ── Optional auth (attach user if token present) ────────── */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch { /* ignore invalid tokens */ }
  }
  next();
});

module.exports = { protect, restrictTo, optionalAuth };
