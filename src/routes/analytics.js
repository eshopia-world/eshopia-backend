'use strict';
const express   = require('express');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const User      = require('../models/User');
const Affiliate = require('../models/Affiliate');
const { asyncHandler }      = require('../middleware/errorHandler');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// All analytics require admin access
router.use(protect, restrictTo('admin', 'superadmin'));

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/overview  — Main KPI dashboard
   ──────────────────────────────────────────────────────────── */
router.get('/overview', asyncHandler(async (req, res) => {
  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week    = new Date(Date.now() - 7  * 86400000);
  const month   = new Date(Date.now() - 30 * 86400000);

  const [
    todayOrders, weekOrders, monthOrders,
    statusBreakdown, topProducts, topCities,
    affiliateStats, revenueByDay,
  ] = await Promise.all([

    // Today's orders
    Order.aggregate([
      { $match: { createdAt: { $gte: today } } },
      { $group: {
        _id:      null,
        count:    { $sum: 1 },
        revenue:  { $sum: '$total' },
        delivered: { $sum: { $cond: [{ $eq: ['$status','delivered'] }, 1, 0] } },
        refused:  { $sum: { $cond: [{ $eq: ['$status','refused'] }, 1, 0] } },
      }},
    ]),

    // This week
    Order.aggregate([
      { $match: { createdAt: { $gte: week } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$total' } }},
    ]),

    // This month
    Order.aggregate([
      { $match: { createdAt: { $gte: month } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$total' } }},
    ]),

    // Status breakdown (all time)
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } }},
    ]),

    // Top 10 products by revenue
    Order.aggregate([
      { $match: { status: { $in: ['delivered','confirmed','shipped'] } }},
      { $unwind: '$items' },
      { $group: {
        _id:      '$items.productId',
        name:     { $first: '$items.productName' },
        revenue:  { $sum: { $multiply: ['$items.price','$items.qty'] } },
        unitsSold: { $sum: '$items.qty' },
      }},
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),

    // Top cities
    Order.aggregate([
      { $group: { _id: '$client.city', count: { $sum: 1 }, revenue: { $sum: '$total' } }},
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),

    // Affiliate overview
    Affiliate.aggregate([
      { $group: {
        _id:       null,
        total:     { $sum: 1 },
        clicks:    { $sum: '$totalClicks' },
        orders:    { $sum: '$totalOrders' },
        commissions: { $sum: '$totalEarned' },
      }},
    ]),

    // Revenue by day (last 14 days)
    Order.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } } },
      { $group: {
        _id:     { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$total' },
        orders:  { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ]);

  const t  = todayOrders[0] || { count: 0, revenue: 0, delivered: 0, refused: 0 };
  const w  = weekOrders[0]  || { count: 0, revenue: 0 };
  const m  = monthOrders[0] || { count: 0, revenue: 0 };
  const sm = Object.fromEntries(statusBreakdown.map(s => [s._id, s.count]));
  const totalOrders = Object.values(sm).reduce((a, b) => a + b, 0);

  res.json({
    status: 'success',
    overview: {
      today:   { orders: t.count, revenue: t.revenue, delivered: t.delivered, refused: t.refused },
      week:    { orders: w.count, revenue: w.revenue },
      month:   { orders: m.count, revenue: m.revenue },
      allTime: {
        totalOrders,
        pending:   sm.pending   || 0,
        confirmed: sm.confirmed || 0,
        shipped:   sm.shipped   || 0,
        delivered: sm.delivered || 0,
        refused:   sm.refused   || 0,
        cancelled: sm.cancelled || 0,
        deliveryRate:  totalOrders > 0 ? Math.round(((sm.delivered||0) / totalOrders) * 100) : 0,
        refusalRate:   totalOrders > 0 ? Math.round(((sm.refused||0)   / totalOrders) * 100) : 0,
      },
    },
    topProducts,
    topCities,
    affiliates: affiliateStats[0] || { total: 0, clicks: 0, orders: 0, commissions: 0 },
    revenueByDay,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/client-scores  — Client scoring report
   ──────────────────────────────────────────────────────────── */
router.get('/client-scores', asyncHandler(async (req, res) => {
  const scores = await User.aggregate([
    { $match: { role: 'client' } },
    { $group: {
      _id:   null,
      avg:   { $avg: '$clientScore.total' },
      high:  { $sum: { $cond: [{ $gte: ['$clientScore.total', 70] }, 1, 0] } },
      med:   { $sum: { $cond: [{ $and: [{ $gte: ['$clientScore.total', 40] }, { $lt: ['$clientScore.total', 70] }] }, 1, 0] } },
      low:   { $sum: { $cond: [{ $lt: ['$clientScore.total', 40] }, 1, 0] } },
      total: { $sum: 1 },
    }},
  ]);

  const topClients = await User.find({ role: 'client' })
    .sort('-clientScore.total')
    .limit(20)
    .select('name phone city clientScore loyaltyPoints');

  res.json({ status: 'success', scores: scores[0], topClients });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/products  — Product performance
   ──────────────────────────────────────────────────────────── */
router.get('/products', asyncHandler(async (req, res) => {
  const [performance, lowStock, views] = await Promise.all([
    Product.find({ isActive: true })
      .sort('-sold')
      .limit(20)
      .select('name cat price sold stock views'),
    Product.find({ isActive: true, stock: { $lte: 10, $gt: 0 } })
      .sort('stock')
      .select('name stock price'),
    Product.find({ isActive: true })
      .sort('-views')
      .limit(10)
      .select('name views sold'),
  ]);

  res.json({ status: 'success', performance, lowStock, mostViewed: views });
}));

module.exports = router;
