'use strict';
const express = require('express');
const User    = require('../models/User');
const Order   = require('../models/Order');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const router  = express.Router();

/* GET /api/agents */
router.get('/', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const agents = await User.find({ role:'agent', isActive:true }).lean();
  const result = await Promise.all(agents.map(async a => {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayCalls = await Order.countDocuments({ assignedAgent:a._id, updatedAt:{ $gte:today } });
    const totalConf  = await Order.countDocuments({ assignedAgent:a._id, status:'confirmed' });
    const totalRef   = await Order.countDocuments({ assignedAgent:a._id, status:'refused' });
    const total      = totalConf + totalRef;
    return { ...a, stats:{ todayCalls, confirmed:totalConf, refused:totalRef, total, rate: total>0?Math.round(totalConf/total*100):0 } };
  }));
  res.json({ status:'success', agents:result });
}));

/* POST /api/agents */
router.post('/', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ status:'fail', message:'All fields required.' });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ status:'fail', message:'Email already exists.' });
  const agent = await User.create({ name, email, password, phone, role:'agent' });
  res.status(201).json({ status:'success', agent });
}));

/* GET /api/agents/my-stats */
router.get('/my-stats', protect, restrictTo('agent'), asyncHandler(async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const [todayCalls, totalConf, totalRef] = await Promise.all([
    Order.countDocuments({ assignedAgent:req.user._id, updatedAt:{ $gte:today } }),
    Order.countDocuments({ assignedAgent:req.user._id, status:'confirmed' }),
    Order.countDocuments({ assignedAgent:req.user._id, status:'refused' }),
  ]);
  const total = totalConf + totalRef;
  res.json({ status:'success', stats:{ todayCalls, confirmed:totalConf, refused:totalRef, total, rate:total>0?Math.round(totalConf/total*100):0 } });
}));

/* PUT /api/agents/:id/deactivate */
router.put('/:id/deactivate', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { isActive:false });
  res.json({ status:'success', message:'Agent deactivated.' });
}));

module.exports = router;
