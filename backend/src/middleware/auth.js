'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const protect = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'fail', message: 'Not authenticated.' });
  }
  const token = auth.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  if (!user || !user.isActive || user.isBanned) {
    return res.status(401).json({ status: 'fail', message: 'User not found or banned.' });
  }
  req.user = user;
  next();
});

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ status: 'fail', message: 'Access denied.' });
  }
  next();
};

const optionalAuth = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id);
    } catch {}
  }
  next();
});

module.exports = { protect, restrictTo, optionalAuth, asyncHandler };
