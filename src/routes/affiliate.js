'use strict';
const express   = require('express');
const crypto    = require('crypto');
const Affiliate = require('../models/Affiliate');
const Order     = require('../models/Order');
const User      = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { protect, restrictTo } = require('../middleware/auth');
const { clickLimiter } = require('../middleware/rateLimiter');
const fraudService = require('../services/fraudService');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   POST /api/affiliate/register  — Register as affiliate
   ──────────────────────────────────────────────────────────── */
router.post('/register', protect, asyncHandler(async (req, res, next) => {
  const existing = await Affiliate.findOne({ userId: req.user._id });
  if (existing) return next(new AppError('You are already registered as an affiliate.', 409));

  // Generate unique code from name
  const baseCode = req.user.name
    .split(' ')[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

  let code = baseCode;
  let attempt = 0;
  while (await Affiliate.findOne({ code })) {
    attempt++;
    code = `${baseCode}${attempt}`;
  }

  const affiliate = await Affiliate.create({
    userId:    req.user._id,
    userName:  req.user.name,
    userEmail: req.user.email,
    code,
    commissionRate: parseFloat(process.env.AFFILIATE_COMMISSION_RATE) || 0.10,
  });

  res.status(201).json({
    status: 'success',
    affiliate: {
      code:    affiliate.code,
      link:    `https://eshopia.ma/?ref=${affiliate.code}`,
      commissionRate: affiliate.commissionRate,
    },
  });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/affiliate/click  — Record a referral click
   ──────────────────────────────────────────────────────────── */
router.post('/click', clickLimiter, asyncHandler(async (req, res) => {
  const { code, page, referrer } = req.body;
  if (!code) return res.json({ status: 'ok' });

  const affiliate = await Affiliate.findOne({ code: code.toUpperCase(), isActive: true });
  if (!affiliate) return res.json({ status: 'ok', message: 'Code not found' });

  const clientIp   = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const ipHash     = crypto.createHash('sha256').update(clientIp + code).digest('hex');
  const userAgent  = req.headers['user-agent'];

  // Deduplication: same IP+code within 24h = duplicate
  const oneDayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const isDuplicate = await Affiliate.findOne({
    _id: affiliate._id,
    'recentClicks.ipHash': ipHash,
    'recentClicks.timestamp': { $gte: oneDayAgo },
  });

  const clickData = { ipHash, userAgent, page, referrer, isDuplicate: !!isDuplicate };

  await Affiliate.findByIdAndUpdate(affiliate._id, {
    $inc: {
      totalClicks:  1,
      uniqueClicks: isDuplicate ? 0 : 1,
    },
    $push: {
      recentClicks: {
        $each:  [clickData],
        $slice: -200, // keep only last 200 clicks
      },
    },
  });

  // Async fraud check (don't block response)
  fraudService.checkAffiliateClicks(affiliate._id).catch(() => {});

  res.json({ status: 'ok', unique: !isDuplicate });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/affiliate/stats  — Affiliate dashboard stats
   ──────────────────────────────────────────────────────────── */
router.get('/stats', protect, asyncHandler(async (req, res, next) => {
  const affiliate = await Affiliate.findOne({ userId: req.user._id });
  if (!affiliate) return next(new AppError('You are not registered as an affiliate.', 404));

  // Fetch recent sales
  const sales = await Order.find({
    affiliateId: affiliate._id,
    status: { $nin: ['pending', 'cancelled'] },
  })
    .sort('-createdAt')
    .limit(20)
    .select('orderNumber createdAt items total affiliateCommission commissionStatus status');

  // Monthly breakdown (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyData = await Order.aggregate([
    { $match: { affiliateId: affiliate._id, createdAt: { $gte: sixMonthsAgo } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
      orders:     { $sum: 1 },
      commission: { $sum: '$affiliateCommission' },
    }},
    { $sort: { _id: 1 } },
  ]);

  const conversionRate = affiliate.totalClicks > 0
    ? ((affiliate.totalOrders / affiliate.uniqueClicks) * 100).toFixed(1)
    : 0;

  // Leaderboard rank
  const rank = await Affiliate.countDocuments({ totalEarned: { $gt: affiliate.totalEarned } });

  res.json({
    status: 'success',
    code:           affiliate.code,
    link:           `https://eshopia.ma/?ref=${affiliate.code}`,
    totalClicks:    affiliate.totalClicks,
    uniqueClicks:   affiliate.uniqueClicks,
    totalOrders:    affiliate.totalOrders,
    deliveredOrders: affiliate.deliveredOrders,
    totalEarned:    affiliate.totalEarned,
    pendingBalance: affiliate.pendingBalance,
    availableBalance: affiliate.availableBalance,
    totalPaidOut:   affiliate.totalPaidOut,
    commissionRate: affiliate.commissionRate,
    conversionRate,
    rank:  rank + 1,
    tier:  affiliate.tier,
    isActive: affiliate.isActive,
    fraudScore: affiliate.fraudScore,
    createdAt: affiliate.createdAt,
    sales,
    monthlyData,
    payouts: affiliate.payouts.slice(-5),
  });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/affiliate/payout  — Request a payout
   ──────────────────────────────────────────────────────────── */
router.post('/payout', protect, asyncHandler(async (req, res, next) => {
  const { amount, method, iban, note } = req.body;
  const minPayout = parseFloat(process.env.AFFILIATE_MIN_PAYOUT) || 200;

  const affiliate = await Affiliate.findOne({ userId: req.user._id });
  if (!affiliate) return next(new AppError('Affiliate account not found.', 404));

  if (!affiliate.isActive || affiliate.autoSuspended) {
    return next(new AppError('Account suspended. Contact support.', 403));
  }
  if (amount < minPayout) {
    return next(new AppError(`Minimum payout is ${minPayout} MAD.`, 400));
  }
  if (amount > affiliate.availableBalance) {
    return next(new AppError(`Insufficient balance. Available: ${affiliate.availableBalance} MAD.`, 400));
  }

  const payout = {
    amount, method, iban, note,
    status: 'pending',
    requestedAt: new Date(),
  };

  await Affiliate.findByIdAndUpdate(affiliate._id, {
    $push: { payouts: payout },
    $inc:  { availableBalance: -amount },
  });

  res.json({
    status: 'success',
    message: `Payout request of ${amount} MAD submitted. Processing within 48h.`,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/affiliate/all  — Admin: list all affiliates
   ──────────────────────────────────────────────────────────── */
router.get('/all', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, sort = '-totalEarned' } = req.query;

  const affiliates = await Affiliate.find()
    .sort(sort)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .select('-recentClicks -monthlyStats');

  const total = await Affiliate.countDocuments();

  res.json({ status: 'success', total, affiliates });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/affiliate/:id/toggle  — Admin: activate/suspend
   ──────────────────────────────────────────────────────────── */
router.put('/:id/toggle', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const affiliate = await Affiliate.findByIdAndUpdate(
    req.params.id,
    { isActive: req.body.isActive, autoSuspended: false },
    { new: true }
  );
  if (!affiliate) return next(new AppError('Affiliate not found.', 404));
  res.json({ status: 'success', affiliate });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/affiliate/:affId/payout/:payoutId/pay  — Admin: approve payout
   ──────────────────────────────────────────────────────────── */
router.put('/:affId/payout/:payoutId/pay', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const affiliate = await Affiliate.findById(req.params.affId);
  if (!affiliate) return next(new AppError('Affiliate not found.', 404));

  const payout = affiliate.payouts.id(req.params.payoutId);
  if (!payout) return next(new AppError('Payout not found.', 404));

  payout.status = 'paid';
  payout.processedAt = new Date();
  payout.adminNote = req.body.note;
  affiliate.totalPaidOut += payout.amount;

  await affiliate.save();
  res.json({ status: 'success', message: `Payout of ${payout.amount} MAD marked as paid.` });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/affiliate/leaderboard  — Public leaderboard
   ──────────────────────────────────────────────────────────── */
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const leaders = await Affiliate.find({ isActive: true, autoSuspended: false })
    .sort('-totalEarned')
    .limit(10)
    .select('userName totalEarned deliveredOrders tier');

  res.json({ status: 'success', leaders });
}));

module.exports = router;
