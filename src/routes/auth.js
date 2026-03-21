'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { protect }    = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/* ── POST /api/auth/register ─────────────────────────────── */
router.post('/register', authLimiter, asyncHandler(async (req, res, next) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return next(new AppError('Name, email, and password are required.', 400));
  if (password.length < 8)
    return next(new AppError('Password must be at least 8 characters.', 400));

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return next(new AppError('Email already registered.', 409));

  const user = await User.create({ name, email, password, phone, role: 'client' });

  const accessToken  = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken  = refreshToken;
  user.lastLoginAt   = new Date();
  await user.save({ validateBeforeSave: false });

  res.status(201).json({
    status: 'success',
    token:  accessToken,
    refreshToken,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
}));

/* ── POST /api/auth/login ────────────────────────────────── */
router.post('/login', authLimiter, asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) return next(new AppError('Email and password required.', 400));

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +refreshToken');
  if (!user || !(await user.comparePassword(password)))
    return next(new AppError('Incorrect email or password.', 401));
  if (user.isBanned) return next(new AppError('Account suspended. Contact support.', 403));

  const accessToken  = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken  = refreshToken;
  user.lastLoginAt   = new Date();
  user.lastLoginIp   = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  await user.save({ validateBeforeSave: false });

  res.json({
    status: 'success',
    token:  accessToken,
    refreshToken,
    user: {
      id:            user._id,
      name:          user.name,
      email:         user.email,
      role:          user.role,
      loyaltyPoints: user.loyaltyPoints,
      clientScore:   user.clientScore?.total,
    },
  });
}));

/* ── POST /api/auth/refresh ──────────────────────────────── */
router.post('/refresh', asyncHandler(async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return next(new AppError('Refresh token required.', 400));

  let decoded;
  try {
    const secret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET + '_refresh');
    decoded = jwt.verify(refreshToken, secret);
  } catch {
    return next(new AppError('Invalid or expired refresh token.', 401));
  }

  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || user.refreshToken !== refreshToken)
    return next(new AppError('Session expired. Please log in again.', 401));

  const newAccess  = user.generateAccessToken();
  const newRefresh = user.generateRefreshToken();
  user.refreshToken = newRefresh;
  await user.save({ validateBeforeSave: false });

  res.json({ status: 'success', token: newAccess, refreshToken: newRefresh });
}));

/* ── GET /api/auth/me ─────────────────────────────────────── */
router.get('/me', protect, asyncHandler(async (req, res) => {
  res.json({ status: 'success', user: req.user });
}));

/* ── POST /api/auth/logout ────────────────────────────────── */
router.post('/logout', protect, asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
  res.json({ status: 'success', message: 'Logged out successfully.' });
}));

/* ── PUT /api/auth/password  — Change password ────────────── */
router.put('/password', protect, asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return next(new AppError('Current and new password required.', 400));
  if (newPassword.length < 8)
    return next(new AppError('New password must be at least 8 characters.', 400));

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword)))
    return next(new AppError('Current password is incorrect.', 401));

  user.password = newPassword;
  await user.save();

  res.json({ status: 'success', message: 'Password updated successfully.' });
}));

module.exports = router;
