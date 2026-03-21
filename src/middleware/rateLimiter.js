'use strict';
const rateLimit = require('express-rate-limit');

const createLimiter = (max, windowMs, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message },
    skip: req => process.env.NODE_ENV === 'test',
  });

// General API limiter
const limiter = createLimiter(
  parseInt(process.env.RATE_LIMIT_MAX) || 100,
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  'Too many requests. Please try again later.'
);

// Strict limiter for order creation (prevent COD flood attacks)
const orderLimiter = createLimiter(
  parseInt(process.env.ORDER_RATE_LIMIT_MAX) || 3,
  60 * 60 * 1000, // 1 hour
  'Too many orders placed. Maximum 3 orders per hour per IP.'
);

// Auth limiter (prevent brute force)
const authLimiter = createLimiter(
  10,
  15 * 60 * 1000, // 15 minutes
  'Too many login attempts. Please try again in 15 minutes.'
);

// Affiliate click limiter (prevent click fraud)
const clickLimiter = createLimiter(
  20,
  60 * 60 * 1000, // 1 hour
  'Too many affiliate clicks from this IP.'
);

module.exports = { limiter, orderLimiter, authLimiter, clickLimiter };
