'use strict';
const rateLimit = require('express-rate-limit');

const createLimiter = (max, windowMs, message) =>
  rateLimit({
    windowMs, max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { status: 'fail', message },
    skip: req => process.env.NODE_ENV === 'test',
  });

const limiter = createLimiter(
  parseInt(process.env.RATE_LIMIT_MAX) || 100,
  15 * 60 * 1000,
  'Too many requests. Please try again later.'
);

const orderLimiter = createLimiter(
  parseInt(process.env.ORDER_RATE_LIMIT_MAX) || 3,
  60 * 60 * 1000,
  'Too many orders placed. Maximum 3 orders per hour per IP.'
);

const authLimiter = createLimiter(
  10, 15 * 60 * 1000,
  'Too many login attempts. Please try again in 15 minutes.'
);

const clickLimiter = createLimiter(
  20, 60 * 60 * 1000,
  'Too many affiliate clicks from this IP.'
);

module.exports = { limiter, orderLimiter, authLimiter, clickLimiter };
