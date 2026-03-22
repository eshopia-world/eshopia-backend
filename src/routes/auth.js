'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { asyncHandler, protect } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const router  = express.Router();

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { status:'fail', message:'Too many attempts' }});

const signAccess  = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
const signRefresh = id => jwt.sign({ id }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET+'_r', { expiresIn: '7d' });

/* POST /api/auth/register */
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ status:'fail', message:'Name, email and password required.' });
  if (password.length < 8) return res.status(400).json({ status:'fail', message:'Password min 8 chars.' });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ status:'fail', message:'Email already registered.' });
  const user = await User.create({ name, email, password, phone, role: 'client' });
  const token = signAccess(user._id);
  const refreshToken = signRefresh(user._id);
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });
  res.status(201).json({ status:'success', token, refreshToken, user: { id:user._id, name:user.name, email:user.email, role:user.role } });
}));

/* POST /api/auth/login */
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ status:'fail', message:'Email and password required.' });
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +refreshToken');
  if (!user || !(await user.comparePassword(password))) return res.status(401).json({ status:'fail', message:'Incorrect email or password.' });
  if (user.isBanned) return res.status(403).json({ status:'fail', message:'Account suspended.' });
  const token = signAccess(user._id);
  const refreshToken = signRefresh(user._id);
  user.refreshToken = refreshToken;
  user.lastLoginAt  = new Date();
  await user.save({ validateBeforeSave: false });
  res.json({ status:'success', token, refreshToken, user: { id:user._id, name:user.name, email:user.email, role:user.role, loyaltyPoints:user.loyaltyPoints, clientScore:user.clientScore?.total } });
}));

/* POST /api/auth/refresh */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ status:'fail', message:'Refresh token required.' });
  let decoded;
  try { decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET+'_r'); }
  catch { return res.status(401).json({ status:'fail', message:'Invalid refresh token.' }); }
  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || user.refreshToken !== refreshToken) return res.status(401).json({ status:'fail', message:'Session expired.' });
  const newToken = signAccess(user._id);
  const newRefresh = signRefresh(user._id);
  user.refreshToken = newRefresh;
  await user.save({ validateBeforeSave: false });
  res.json({ status:'success', token:newToken, refreshToken:newRefresh });
}));

/* GET /api/auth/me */
router.get('/me', protect, (req, res) => res.json({ status:'success', user:req.user }));

/* POST /api/auth/logout */
router.post('/logout', protect, asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken:1 } });
  res.json({ status:'success', message:'Logged out.' });
}));

/* PUT /api/auth/password */
router.put('/password', protect, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8)
    return res.status(400).json({ status:'fail', message:'Invalid passwords.' });
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword)))
    return res.status(401).json({ status:'fail', message:'Current password incorrect.' });
  user.password = newPassword;
  await user.save();
  res.json({ status:'success', message:'Password updated.' });
}));

module.exports = router;
