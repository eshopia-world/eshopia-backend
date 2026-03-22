'use strict';
const express   = require('express');
const crypto    = require('crypto');
const Affiliate = require('../models/Affiliate');
const Order     = require('../models/Order');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const clickLimiter = rateLimit({ windowMs: 60*60*1000, max: 20, message:{ status:'fail', message:'Too many clicks.' }});

/* POST /api/affiliate/register */
router.post('/register', protect, asyncHandler(async (req, res) => {
  const existing = await Affiliate.findOne({ userId: req.user._id });
  if (existing) return res.status(409).json({ status:'fail', message:'Already registered.' });
  const baseCode = req.user.name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
  let code = baseCode; let i = 0;
  while (await Affiliate.findOne({ code })) { i++; code = baseCode + i; }
  const aff = await Affiliate.create({
    userId: req.user._id, userName: req.user.name, userEmail: req.user.email,
    code, commissionRate: parseFloat(process.env.AFFILIATE_COMMISSION_RATE) || 0.10,
  });
  res.status(201).json({ status:'success', affiliate:{ code:aff.code, link:`https://eshopia.netlify.app/?ref=${aff.code}`, commissionRate:aff.commissionRate } });
}));

/* POST /api/affiliate/click */
router.post('/click', clickLimiter, asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ status:'ok' });
  const aff = await Affiliate.findOne({ code: code.toUpperCase(), isActive:true, autoSuspended:false });
  if (!aff) return res.json({ status:'ok' });
  const ip     = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const ipHash = crypto.createHash('sha256').update(ip+code).digest('hex');
  await Affiliate.findByIdAndUpdate(aff._id, { $inc:{ totalClicks:1, uniqueClicks:1 } });
  res.json({ status:'ok' });
}));

/* GET /api/affiliate/stats */
router.get('/stats', protect, asyncHandler(async (req, res) => {
  const aff = await Affiliate.findOne({ userId: req.user._id });
  if (!aff) return res.status(404).json({ status:'fail', message:'Not registered as affiliate.' });
  const sales = await Order.find({ affiliateId:aff._id, status:{ $nin:['pending','cancelled'] } })
    .sort('-createdAt').limit(20).select('orderNumber createdAt total affiliateCommission commissionStatus status');
  const convRate = aff.totalClicks > 0 ? ((aff.totalOrders/aff.uniqueClicks)*100).toFixed(1) : 0;
  const rank = await Affiliate.countDocuments({ totalEarned:{ $gt:aff.totalEarned } });
  res.json({ status:'success', code:aff.code, link:`https://eshopia.netlify.app/?ref=${aff.code}`,
    totalClicks:aff.totalClicks, uniqueClicks:aff.uniqueClicks, totalOrders:aff.totalOrders,
    deliveredOrders:aff.deliveredOrders, totalEarned:aff.totalEarned, pendingBalance:aff.pendingBalance,
    availableBalance:aff.availableBalance, totalPaidOut:aff.totalPaidOut, commissionRate:aff.commissionRate,
    conversionRate:convRate, rank:rank+1, tier:aff.tier, isActive:aff.isActive, sales, payouts:aff.payouts.slice(-5),
  });
}));

/* POST /api/affiliate/payout */
router.post('/payout', protect, asyncHandler(async (req, res) => {
  const { amount, method, iban } = req.body;
  const minPayout = parseFloat(process.env.AFFILIATE_MIN_PAYOUT) || 200;
  const aff = await Affiliate.findOne({ userId: req.user._id });
  if (!aff) return res.status(404).json({ status:'fail', message:'Not found.' });
  if (!aff.isActive || aff.autoSuspended) return res.status(403).json({ status:'fail', message:'Account suspended.' });
  if (amount < minPayout) return res.status(400).json({ status:'fail', message:`Minimum payout: ${minPayout} MAD.` });
  if (amount > aff.availableBalance) return res.status(400).json({ status:'fail', message:'Insufficient balance.' });
  await Affiliate.findByIdAndUpdate(aff._id, {
    $push:{ payouts:{ amount, method, iban, status:'pending', requestedAt:new Date() } },
    $inc:{ availableBalance:-amount },
  });
  res.json({ status:'success', message:`Payout of ${amount} MAD submitted.` });
}));

/* GET /api/affiliate/leaderboard */
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const leaders = await Affiliate.find({ isActive:true, autoSuspended:false })
    .sort('-totalEarned').limit(10).select('userName totalEarned deliveredOrders tier');
  res.json({ status:'success', leaders });
}));

/* GET /api/affiliate/all — Admin */
router.get('/all', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const { page=1, limit=25 } = req.query;
  const affiliates = await Affiliate.find().sort('-totalEarned').limit(+limit).skip((+page-1)*+limit).lean();
  const total = await Affiliate.countDocuments();
  res.json({ status:'success', total, affiliates });
}));

/* PUT /api/affiliate/:id/toggle — Admin */
router.put('/:id/toggle', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const aff = await Affiliate.findByIdAndUpdate(req.params.id, { isActive:req.body.isActive, autoSuspended:false }, { new:true });
  if (!aff) return res.status(404).json({ status:'fail', message:'Not found.' });
  res.json({ status:'success', affiliate:aff });
}));

/* PUT /api/affiliate/:affId/payout/:payoutId/pay — Admin */
router.put('/:affId/payout/:payoutId/pay', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const aff = await Affiliate.findById(req.params.affId);
  if (!aff) return res.status(404).json({ status:'fail', message:'Not found.' });
  const payout = aff.payouts.id(req.params.payoutId);
  if (!payout) return res.status(404).json({ status:'fail', message:'Payout not found.' });
  payout.status = 'paid'; payout.processedAt = new Date();
  aff.totalPaidOut += payout.amount;
  await aff.save();
  res.json({ status:'success', message:`Payout ${payout.amount} MAD marked as paid.` });
}));

module.exports = router;
