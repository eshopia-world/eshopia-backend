'use strict';
const express   = require('express');
const rateLimit = require('express-rate-limit');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const User      = require('../models/User');
const Affiliate = require('../models/Affiliate');
const { asyncHandler, protect, restrictTo, optionalAuth } = require('../middleware/auth');
const router    = express.Router();

const orderLimiter = rateLimit({ windowMs: 60*60*1000, max: 3, message: { status:'fail', message:'Max 3 orders per hour.' }});

/* ── Fraud scoring ─────────────────────────────── */
async function scoreOrder(req, phone) {
  let score = 0;
  const flags = [];
  // Phone history
  const phoneOrders = await Order.find({ 'client.phone': phone }).select('status').lean();
  const refused = phoneOrders.filter(o => o.status === 'refused').length;
  if (phoneOrders.length > 0) {
    const rate = refused / phoneOrders.length;
    if (rate > 0.7)      { score += 40; flags.push('HIGH_REFUSAL_RATE'); }
    else if (rate > 0.5) { score += 20; flags.push('MEDIUM_REFUSAL_RATE'); }
  }
  // Today orders same phone
  const today = new Date(); today.setHours(0,0,0,0);
  const todayCount = await Order.countDocuments({ 'client.phone': phone, createdAt: { $gte: today } });
  if (todayCount >= 3) { score += 30; flags.push('MULTIPLE_ORDERS_SAME_DAY'); }
  // IP velocity
  if (req.ip) {
    const hourAgo = new Date(Date.now() - 3600000);
    const ipCount = await Order.countDocuments({ clientIp: req.ip, createdAt: { $gte: hourAgo } });
    if (ipCount >= 5) { score += 35; flags.push('IP_VELOCITY_HIGH'); }
  }
  return { score: Math.min(100, score), flags };
}

/* POST /api/orders — Place order */
router.post('/', orderLimiter, optionalAuth, asyncHandler(async (req, res) => {
  const { client, items, affiliateCode, idempotencyKey, lang, source } = req.body;
  if (!client?.name || !client?.phone || !client?.city || !client?.address)
    return res.status(400).json({ status:'fail', message:'Client info required.' });
  if (!items?.length)
    return res.status(400).json({ status:'fail', message:'Order must have items.' });
  if (!client.phone.match(/^0[5-7]\d{8}$/))
    return res.status(400).json({ status:'fail', message:'Invalid Moroccan phone number.' });

  // Idempotency
  if (idempotencyKey) {
    const existing = await Order.findOne({ idempotencyKey });
    if (existing) return res.json({ status:'success', order: existing, duplicate: true });
  }

  // Fraud check
  const { score, flags } = await scoreOrder(req, client.phone);
  if (score >= 80) return res.status(422).json({ status:'fail', message:'Order blocked for security reasons.' });

  // Build items & decrement stock
  const orderItems = [];
  let subtotal = 0;
  for (const item of items) {
    const product = await Product.findOneAndUpdate(
      { _id: item.productId, stock: { $gte: item.qty || 1 }, isActive: true },
      { $inc: { stock: -(item.qty || 1), sold: (item.qty || 1) } },
      { new: true } // NOT lean - we need virtuals (effectivePrice)
    );
    if (!product) return res.status(400).json({ status:'fail', message:`Product ${item.productId} unavailable.` });
    // effectivePrice is a virtual - works on full mongoose document
    const itemPrice = (product.flashDeal?.isActive && product.flashDeal?.flashPrice && new Date() < product.flashDeal.endTime)
      ? product.flashDeal.flashPrice
      : product.price;
    orderItems.push({ productId: product._id, productName: product.name, qty: item.qty||1, price: itemPrice });
    subtotal += product.price * (item.qty || 1);
  }

  // Delivery fee
  const FREE_FROM = parseFloat(process.env.FREE_DELIVERY_THRESHOLD) || 129;
  const EXPRESS_CITIES = ['Casablanca','Rabat','Marrakech'];
  const deliveryFee = subtotal >= FREE_FROM ? 0 : EXPRESS_CITIES.includes(client.city) ? 0 : 30;

  // Affiliate
  let affiliateId = null;
  let commission  = 0;
  if (affiliateCode) {
    const aff = await Affiliate.findOne({ code: affiliateCode.toUpperCase(), isActive: true, autoSuspended: false });
    if (aff) {
      // Self-referral check
      const isSelf = req.user && (String(req.user._id) === String(aff.userId));
      // userPhone not stored in affiliate - check via User model
      let isSamePhone = false;
      if (aff.userId) {
        const affUser = await User.findById(aff.userId).select('phone').lean();
        isSamePhone = affUser?.phone && affUser.phone === client.phone;
      }
      if (!isSelf && !isSamePhone) {
        affiliateId = aff._id;
        commission  = Math.round(subtotal * (aff.commissionRate || 0.10));
        await Affiliate.findByIdAndUpdate(aff._id, { $inc: { totalOrders: 1, pendingBalance: commission } });
      }
    }
  }

  // Create order
  const order = await Order.create({
    client: { ...client, userId: req.user?._id },
    items:  orderItems,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    affiliateCode: affiliateCode?.toUpperCase(),
    affiliateId,
    affiliateCommission: commission,
    commissionStatus: commission > 0 ? 'pending' : 'none',
    fraudScore: score,
    fraudFlags: flags,
    idempotencyKey,
    clientIp: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
    source: source || 'web',
    lang: lang || 'fr',
  });

  order.lifecycle.push({ status: 'pending', note: 'Order placed' });
  await order.save();

  // Notify (async, don't block response)
  try {
    const notify = require('../services/notifyService');
    notify.orderPlaced(order).catch(() => {});
  } catch {}

  res.status(201).json({
    status: 'success',
    order: {
      orderNumber: order.orderNumber,
      total:       order.total,
      deliveryFee: order.deliveryFee,
      status:      order.status,
      createdAt:   order.createdAt,
    },
  });
}));

/* GET /api/orders/track/:num — Public tracking */
router.get('/track/:num', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.num.toUpperCase() })
    .select('orderNumber status lifecycle client.name client.city total deliveryFee trackingCode confirmedAt shippedAt deliveredAt createdAt items')
    .lean();
  if (!order) return res.status(404).json({ status:'fail', message:'Order not found.' });
  res.json({
    status: 'success',
    tracking: {
      orderNumber: order.orderNumber,
      status:      order.status,
      city:        order.client?.city,
      total:       order.total,
      itemCount:   order.items?.length,
      trackingCode:order.trackingCode,
      timeline:    order.lifecycle,
      confirmedAt: order.confirmedAt,
      shippedAt:   order.shippedAt,
      deliveredAt: order.deliveredAt,
      createdAt:   order.createdAt,
    },
  });
}));

/* GET /api/orders — Admin list */
router.get('/', protect, restrictTo('admin','superadmin','agent'), asyncHandler(async (req, res) => {
  const { status, city, search, limit=25, page=1 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (city)   filter['client.city'] = new RegExp(city, 'i');
  if (search) filter.$or = [
    { orderNumber: new RegExp(search, 'i') },
    { 'client.name': new RegExp(search, 'i') },
    { 'client.phone': new RegExp(search, 'i') },
  ];
  const orders = await Order.find(filter).sort('-createdAt').limit(+limit).skip((+page-1)*+limit).lean();
  const total  = await Order.countDocuments(filter);
  res.json({ status:'success', total, orders });
}));

/* GET /api/orders/stats/summary */
router.get('/stats/summary', protect, restrictTo('admin','superadmin','agent'), asyncHandler(async (req, res) => {
  const [total, pending, confirmed, delivered, refused] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ status:'pending' }),
    Order.countDocuments({ status:'confirmed' }),
    Order.countDocuments({ status:'delivered' }),
    Order.countDocuments({ status:'refused' }),
  ]);
  const revenueAgg = await Order.aggregate([
    { $match: { status: { $in: ['delivered'] } } },
    { $group: { _id: null, revenue: { $sum: '$total' } } },
  ]);
  res.json({ status:'success', total, pending, confirmed, delivered, refused, revenue: revenueAgg[0]?.revenue || 0 });
}));

/* GET /api/orders/queue */
router.get('/queue', protect, restrictTo('admin','superadmin','agent'), asyncHandler(async (req, res) => {
  const orders = await Order.find({ status:'pending', isBlocked:false }).sort('createdAt').limit(50).lean();
  res.json({ status:'success', orders });
}));

/* POST /api/orders/queue/assign-next */
router.post('/queue/assign-next', protect, restrictTo('admin','superadmin','agent'), asyncHandler(async (req, res) => {
  const order = await Order.findOneAndUpdate(
    { status:'pending', isBlocked:false, assignedAgent:null },
    { $set: { assignedAgent:req.user._id, assignedAgentName:req.user.name } },
    { new:true, sort:{ createdAt:1 } }
  );
  if (!order) return res.status(404).json({ status:'fail', message:'Queue empty.' });
  res.json({ status:'success', order });
}));

/* PUT /api/orders/:id/confirm — Update status */
router.put('/:id/confirm', protect, restrictTo('admin','superadmin','agent'), asyncHandler(async (req, res) => {
  const { status, note, trackingCode } = req.body;
  const allowed = ['confirmed','shipped','delivered','refused','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ status:'fail', message:'Invalid status.' });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ status:'fail', message:'Order not found.' });

  order.addLifecycleEvent(status, note || '', req.user._id, req.user.name);
  if (trackingCode) order.trackingCode = trackingCode;

  // Handle affiliate commission
  if (status === 'delivered' && order.affiliateId && order.commissionStatus === 'pending') {
    order.commissionStatus = 'credited';
    await Affiliate.findByIdAndUpdate(order.affiliateId, {
      $inc: { deliveredOrders:1, totalEarned:order.affiliateCommission, availableBalance:order.affiliateCommission, pendingBalance:-order.affiliateCommission },
    });
  }
  if (['refused','cancelled'].includes(status) && order.affiliateId && order.commissionStatus === 'pending') {
    order.commissionStatus = 'cancelled';
    await Affiliate.findByIdAndUpdate(order.affiliateId, {
      $inc: { cancelledOrders:1, pendingBalance:-order.affiliateCommission },
    });
    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { stock:item.qty, sold:-item.qty } });
    }
  }

  // Agent stats
  if (['confirmed','refused'].includes(status)) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'agentStats.totalCalls': 1,
        [`agentStats.${status === 'confirmed' ? 'confirmed' : 'refused'}`]: 1,
      },
    });
  }

  await order.save();

  // Notify customer
  try { require('../services/notifyService').orderStatusUpdated(order).catch(()=>{}); } catch {}

  res.json({ status:'success', order });
}));

module.exports = router;
