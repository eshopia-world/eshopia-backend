'use strict';
const express   = require('express');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const User      = require('../models/User');
const Affiliate = require('../models/Affiliate');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { protect, restrictTo, optionalAuth } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/rateLimiter');
const fraudService    = require('../services/fraudService');
const notifyService   = require('../services/notifyService');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   POST /api/orders  — Place a new order (COD)
   No auth required (COD = cash on delivery)
   ──────────────────────────────────────────────────────────── */
router.post('/', orderLimiter, optionalAuth, asyncHandler(async (req, res, next) => {
  const { client, items, affiliateCode, idempotencyKey, lang, source } = req.body;

  // ── 1. Basic validation ──────────────────────────────────
  if (!client?.name || !client?.phone || !client?.city || !client?.address) {
    return next(new AppError('Name, phone, city and address are required.', 400));
  }
  if (!Array.isArray(items) || items.length === 0) {
    return next(new AppError('Order must contain at least one item.', 400));
  }
  if (!client.phone.match(/^0[5-7]\d{8}$/)) {
    return next(new AppError('Invalid phone number format.', 400));
  }

  // ── 2. Idempotency check (prevent double submission) ─────
  if (idempotencyKey) {
    const existing = await Order.findOne({ idempotencyKey });
    if (existing) {
      return res.json({ status: 'success', order: existing, duplicate: true });
    }
  }

  // ── 3. Validate products & compute totals ────────────────
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await Product.findById(item.productId);
    if (!product || !product.isActive) {
      return next(new AppError(`Product ${item.productId} not found or unavailable.`, 400));
    }
    if (product.stock < item.qty) {
      return next(new AppError(`Insufficient stock for "${product.name}". Available: ${product.stock}`, 400));
    }

    const price = product.effectivePrice;
    subtotal += price * item.qty;
    orderItems.push({
      productId:   product._id,
      productName: product.name,
      productImg:  product.img,
      qty:         item.qty,
      price,
      vendorId:    product.vendorId,
    });
  }

  // ── 4. Delivery fee calculation ──────────────────────────
  const FREE_THRESHOLD = parseFloat(process.env.FREE_DELIVERY_THRESHOLD) || 129;
  const deliveryFee = subtotal >= FREE_THRESHOLD ? 0 : getDeliveryFee(client.city);
  const total = subtotal + deliveryFee;

  // ── 5. Anti-fraud scoring ────────────────────────────────
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const { fraudScore, fraudFlags, isBlocked } = await fraudService.scoreOrder({
    phone: client.phone,
    ip: clientIp,
    total,
    affiliateCode,
  });

  if (isBlocked) {
    return next(new AppError('Order blocked due to suspicious activity. Contact support.', 403));
  }

  // ── 6. Affiliate validation ──────────────────────────────
  let affiliateId = null;
  let commission  = 0;
  let commissionStatus = 'none';

  if (affiliateCode) {
    const aff = await Affiliate.findOne({ code: affiliateCode.toUpperCase(), isActive: true });
    if (aff) {
      // Prevent self-referral
      const isSelfRef = req.user && req.user._id.toString() === aff.userId.toString();
      const isSamePhone = aff.userPhone === client.phone;

      if (!isSelfRef && !isSamePhone) {
        affiliateId = aff._id;
        commission  = Math.round(total * aff.commissionRate);
        commissionStatus = 'pending'; // credited only after delivery
      }
    }
  }

  // ── 7. Create order ──────────────────────────────────────
  const order = await Order.create({
    client:     { ...client, userId: req.user?._id },
    items:      orderItems,
    subtotal,
    deliveryFee,
    total,
    affiliateCode,
    affiliateId,
    affiliateCommission: commission,
    commissionStatus,
    clientIp,
    userAgent:    req.headers['user-agent'],
    fraudScore,
    fraudFlags,
    idempotencyKey,
    lang:   lang || 'fr',
    source: source || 'web',
    lifecycle: [{ status: 'pending', note: 'Order placed via web', timestamp: new Date() }],
  });

  // ── 8. Decrement stock atomically ────────────────────────
  for (const item of orderItems) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { stock: -item.qty },
    });
  }

  // ── 9. Update affiliate click stats ──────────────────────
  if (affiliateId) {
    await Affiliate.findByIdAndUpdate(affiliateId, {
      $inc: { totalOrders: 1, pendingBalance: commission },
    });
  }

  // ── 10. Update client score (if registered) ───────────────
  if (req.user) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'clientScore.ordersPlaced': 1 },
    });
  }

  // ── 11. Send notifications (async, don't block response) ──
  notifyService.orderPlaced(order).catch(() => {});

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully.',
    order: {
      orderNumber: order.orderNumber,
      total:       order.total,
      status:      order.status,
      estimatedDelivery: getEstimatedDelivery(client.city),
    },
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/orders/track/:orderNumber  — Public tracking
   ──────────────────────────────────────────────────────────── */
router.get('/track/:orderNumber', asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber })
    .select('orderNumber status lifecycle client.name client.city total items deliveredAt shippedAt confirmedAt');

  if (!order) return next(new AppError('Order not found. Check your order number.', 404));

  res.json({ status: 'success', order });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/orders  — Admin: list all orders (paginated)
   ──────────────────────────────────────────────────────────── */
router.get('/', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const { status, city, search, page = 1, limit = 25, sort = '-createdAt' } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (city)   filter['client.city'] = new RegExp(city, 'i');
  if (search) {
    filter.$or = [
      { orderNumber: new RegExp(search, 'i') },
      { 'client.name': new RegExp(search, 'i') },
      { 'client.phone': new RegExp(search, 'i') },
    ];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('-lifecycle -fraudFlags -userAgent'),
    Order.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    total,
    pages: Math.ceil(total / parseInt(limit)),
    page: parseInt(page),
    orders,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/orders/stats/summary  — Admin KPIs
   ──────────────────────────────────────────────────────────── */
router.get('/stats/summary', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const [stats, revenue] = await Promise.all([
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['delivered', 'confirmed', 'shipped'] } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
  ]);

  const statusMap = Object.fromEntries(stats.map(s => [s._id, s.count]));

  res.json({
    status: 'success',
    stats: {
      total:     Object.values(statusMap).reduce((a, b) => a + b, 0),
      pending:   statusMap.pending || 0,
      confirmed: statusMap.confirmed || 0,
      shipped:   statusMap.shipped || 0,
      delivered: statusMap.delivered || 0,
      refused:   statusMap.refused || 0,
      cancelled: statusMap.cancelled || 0,
      revenue:   revenue[0]?.total || 0,
      avgOrder:  revenue[0] ? Math.round(revenue[0].total / revenue[0].count) : 0,
    },
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/orders/queue  — Agent: next orders to call
   ──────────────────────────────────────────────────────────── */
router.get('/queue', protect, restrictTo('admin', 'agent', 'superadmin'), asyncHandler(async (req, res) => {
  const queue = await Order.find({ status: 'pending' })
    .sort('createdAt')
    .limit(20)
    .select('orderNumber client.name client.phone client.city total items createdAt fraudScore');

  const [stats] = await Order.aggregate([
    { $group: {
      _id: null,
      total:     { $sum: 1 },
      pending:   { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
      confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
    }},
  ]);

  res.json({ status: 'success', queue, stats: stats || { total: 0, pending: 0, confirmed: 0 } });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/orders/queue/assign-next  — Agent: grab next order
   ──────────────────────────────────────────────────────────── */
router.post('/queue/assign-next', protect, restrictTo('admin', 'agent', 'superadmin'), asyncHandler(async (req, res, next) => {
  const order = await Order.findOneAndUpdate(
    { status: 'pending', assignedAgent: null },
    {
      assignedAgent:     req.user._id,
      assignedAgentName: req.user.name,
      $push: { lifecycle: { status: 'pending', note: `Assigned to agent: ${req.user.name}`, agentId: req.user._id } },
    },
    { sort: 'createdAt', new: true }
  );

  if (!order) return next(new AppError('No orders in queue.', 404));
  res.json({ status: 'success', order });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/orders/:id/confirm  — Agent/Admin: update order status
   ──────────────────────────────────────────────────────────── */
router.put('/:id/confirm', protect, restrictTo('admin', 'agent', 'superadmin'), asyncHandler(async (req, res, next) => {
  const { status, note, trackingCode } = req.body;

  const VALID = ['confirmed', 'shipped', 'delivered', 'refused', 'cancelled'];
  if (!VALID.includes(status)) {
    return next(new AppError(`Invalid status. Must be one of: ${VALID.join(', ')}`, 400));
  }

  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));

  order.addLifecycleEvent(status, note || `Status updated to ${status}`, req.user._id, req.user.name);
  if (trackingCode) order.trackingCode = trackingCode;

  // ── Handle delivered: credit affiliate commission ─────────
  if (status === 'delivered') {
    if (order.affiliateId && order.commissionStatus === 'pending') {
      await Affiliate.findByIdAndUpdate(order.affiliateId, {
        $inc: {
          deliveredOrders: 1,
          availableBalance: order.affiliateCommission,
          pendingBalance:  -order.affiliateCommission,
          totalEarned:      order.affiliateCommission,
        },
      });
      order.commissionStatus = 'credited';
    }
    // Update product sold count
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { sold: item.qty } });
    }
    // Update client score
    if (order.client.userId) {
      const user = await User.findById(order.client.userId);
      if (user) {
        user.clientScore.ordersDelivered += 1;
        user.clientScore.totalSpent += order.total;
        user.loyaltyPoints += Math.floor(order.total / 10);
        user.recomputeScore();
        await user.save({ validateBeforeSave: false });
      }
    }
  }

  // ── Handle refused: cancel affiliate commission ───────────
  if (status === 'refused' || status === 'cancelled') {
    if (order.affiliateId && order.commissionStatus === 'pending') {
      await Affiliate.findByIdAndUpdate(order.affiliateId, {
        $inc: {
          cancelledOrders: 1,
          pendingBalance: -order.affiliateCommission,
        },
      });
      order.commissionStatus = 'cancelled';
    }
    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty } });
    }
    // Update client score
    if (order.client.userId && status === 'refused') {
      const user = await User.findById(order.client.userId);
      if (user) {
        user.clientScore.ordersRefused += 1;
        user.recomputeScore();
        await user.save({ validateBeforeSave: false });
      }
    }
  }

  await order.save();

  // Send status notification
  notifyService.orderStatusUpdated(order).catch(() => {});

  res.json({ status: 'success', order });
}));

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */
function getDeliveryFee(city) {
  const express24h  = ['Casablanca', 'Rabat', 'Marrakech'];
  const standard48h = ['Fès', 'Fes', 'Tanger', 'Agadir', 'Meknès', 'Oujda', 'Kénitra', 'Tétouan'];
  if (express24h.includes(city))  return 0;   // free delivery everywhere (just varies speed)
  if (standard48h.includes(city)) return 0;
  return 0; // COD free delivery across Morocco (adjust as needed)
}

function getEstimatedDelivery(city) {
  const express24h = ['Casablanca', 'Rabat', 'Marrakech'];
  const days = express24h.includes(city) ? 1 : 2;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('fr-MA', { weekday: 'long', day: 'numeric', month: 'long' });
}

module.exports = router;
