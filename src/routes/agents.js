'use strict';
const express = require('express');
const User    = require('../models/User');
const Order   = require('../models/Order');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { protect, restrictTo }    = require('../middleware/auth');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   GET /api/agents  — Admin: list all agents
   ──────────────────────────────────────────────────────────── */
router.get('/', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const agents = await User.find({ role: 'agent', isActive: true })
    .select('name email phone city agentStats createdAt lastLoginAt');
  res.json({ status: 'success', agents });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/agents  — Admin: create agent account
   ──────────────────────────────────────────────────────────── */
router.post('/', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, city } = req.body;
  if (!name || !email || !password) {
    return next(new AppError('Name, email and password are required.', 400));
  }

  const agent = await User.create({ name, email, password, phone, city, role: 'agent' });
  res.status(201).json({ status: 'success', agent });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/agents/my-stats  — Agent: own performance stats
   ──────────────────────────────────────────────────────────── */
router.get('/my-stats', protect, restrictTo('agent', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  const [myOrders, stats] = await Promise.all([
    Order.find({ assignedAgent: agentId })
      .sort('-updatedAt')
      .limit(50)
      .select('orderNumber client.name client.phone client.city status total createdAt'),
    Order.aggregate([
      { $match: { assignedAgent: agentId } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
      }},
    ]),
  ]);

  const statsMap = Object.fromEntries(stats.map(s => [s._id, s.count]));
  const total    = Object.values(statsMap).reduce((a, b) => a + b, 0);
  const confirmed = statsMap.confirmed || 0;

  res.json({
    status: 'success',
    orders: myOrders,
    performance: {
      total,
      confirmed,
      refused:     statsMap.refused    || 0,
      noAnswer:    statsMap.no_answer  || 0,
      rescheduled: statsMap.rescheduled || 0,
      successRate: total > 0 ? Math.round((confirmed / total) * 100) : 0,
    },
  });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/agents/:id/deactivate  — Admin: disable agent
   ──────────────────────────────────────────────────────────── */
router.put('/:id/deactivate', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const agent = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'agent' },
    { isActive: false },
    { new: true }
  );
  if (!agent) return next(new AppError('Agent not found.', 404));
  res.json({ status: 'success', message: 'Agent deactivated.' });
}));

module.exports = router;
