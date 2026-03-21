'use strict';
/* ============================================================
   E-SHOPIA MAROC — Delivery Route
   Handles shipping zones, delivery provider integration,
   auto-send to carrier, and shipment tracking
   ============================================================ */
const express = require('express');
const Order   = require('../models/Order');
const { AppError, asyncHandler }  = require('../middleware/errorHandler');
const { protect, restrictTo }     = require('../middleware/auth');
const notifyService = require('../services/notifyService');
const logger        = require('../utils/logger');

const router = express.Router();

/* ── Delivery fee config (editable via admin) ─────────────── */
const DELIVERY_CONFIG = {
  zones: {
    express: {
      name: 'Express 24h',
      cities: ['Casablanca', 'Rabat', 'Marrakech'],
      fee: 0,
      days: 1,
    },
    standard: {
      name: 'Standard 48h',
      cities: ['Fès', 'Fes', 'Tanger', 'Agadir', 'Meknès', 'Meknes', 'Oujda', 'Kénitra', 'Kenitra', 'Tétouan', 'Tetouan', 'Mohammedia'],
      fee: 0,
      days: 2,
    },
    national: {
      name: 'National 72h',
      cities: [], // all other cities
      fee: 0,
      days: 3,
    },
  },
  freeThreshold: parseFloat(process.env.FREE_DELIVERY_THRESHOLD) || 129,
  providers: {
    amana:       { name: 'Amana',        active: true,  apiUrl: '' },
    chronopost:  { name: 'Chronopost',   active: false, apiUrl: '' },
    ctm:         { name: 'CTM Messagerie', active: false, apiUrl: '' },
  },
};

/* ── Helper: get delivery info for a city ────────────────── */
function getZoneForCity(city) {
  if (!city) return DELIVERY_CONFIG.zones.national;
  const cityNorm = city.trim();
  for (const [key, zone] of Object.entries(DELIVERY_CONFIG.zones)) {
    if (zone.cities.some(c => c.toLowerCase() === cityNorm.toLowerCase())) {
      return { ...zone, key };
    }
  }
  return { ...DELIVERY_CONFIG.zones.national, key: 'national' };
}

/* ────────────────────────────────────────────────────────────
   GET /api/delivery/zones  — Public: get delivery zones & fees
   ──────────────────────────────────────────────────────────── */
router.get('/zones', (req, res) => {
  const { city, subtotal } = req.query;
  const zone = getZoneForCity(city);
  const sub  = parseFloat(subtotal) || 0;
  const fee  = sub >= DELIVERY_CONFIG.freeThreshold ? 0 : zone.fee;

  res.json({
    status: 'success',
    zone: {
      name:     zone.name,
      city:     city || 'Autre',
      fee,
      isFree:   fee === 0,
      days:     zone.days,
      freeFrom: DELIVERY_CONFIG.freeThreshold,
    },
  });
});

/* ────────────────────────────────────────────────────────────
   GET /api/delivery/config  — Admin: get delivery configuration
   ──────────────────────────────────────────────────────────── */
router.get('/config', protect, restrictTo('admin', 'superadmin'), (req, res) => {
  res.json({ status: 'success', config: DELIVERY_CONFIG });
});

/* ────────────────────────────────────────────────────────────
   PUT /api/delivery/config  — Admin: update delivery fees
   ──────────────────────────────────────────────────────────── */
router.put('/config', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const { zones, freeThreshold } = req.body;

  if (zones) {
    Object.assign(DELIVERY_CONFIG.zones, zones);
  }
  if (freeThreshold !== undefined) {
    DELIVERY_CONFIG.freeThreshold = parseFloat(freeThreshold);
  }

  logger.info(`[Delivery] Config updated by ${req.user.name}`);
  res.json({ status: 'success', config: DELIVERY_CONFIG });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/delivery/create  — Admin: create shipment with carrier
   ──────────────────────────────────────────────────────────── */
router.post('/create', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const { orderId, provider = 'amana' } = req.body;
  if (!orderId) return next(new AppError('orderId is required.', 400));

  const order = await Order.findById(orderId);
  if (!order) return next(new AppError('Order not found.', 404));
  if (!['confirmed'].includes(order.status)) {
    return next(new AppError('Order must be in "confirmed" status to create shipment.', 400));
  }

  // Generate tracking code (in production, call carrier API)
  const trackingCode = `${provider.toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;

  // Update order
  order.trackingCode = trackingCode;
  order.addLifecycleEvent(
    'shipped',
    `Shipment created via ${provider}. Tracking: ${trackingCode}`,
    req.user._id,
    req.user.name
  );
  await order.save();

  // Notify customer
  notifyService.orderStatusUpdated(order).catch(() => {});

  logger.info(`[Delivery] Shipment created for order ${order.orderNumber} via ${provider}: ${trackingCode}`);

  res.json({
    status: 'success',
    message: 'Shipment created successfully.',
    trackingCode,
    provider,
    orderNumber: order.orderNumber,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/delivery/track/:tracking  — Get shipment status from carrier
   ──────────────────────────────────────────────────────────── */
router.get('/track/:tracking', asyncHandler(async (req, res, next) => {
  const { tracking } = req.params;

  // Find order by tracking code
  const order = await Order.findOne({ trackingCode: tracking })
    .select('orderNumber status lifecycle client.city trackingCode shippedAt deliveredAt');

  if (!order) return next(new AppError('Tracking code not found.', 404));

  // In production: call carrier API here (Amana, Chronopost, etc.)
  // For now, return order status
  res.json({
    status: 'success',
    tracking: {
      code:        order.trackingCode,
      orderNumber: order.orderNumber,
      status:      order.status,
      city:        order.client.city,
      shippedAt:   order.shippedAt,
      deliveredAt: order.deliveredAt,
      history:     order.lifecycle.filter(e => ['shipped', 'delivered'].includes(e.status)),
    },
  });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/delivery/sync  — Admin: sync delivery statuses from carrier
   ──────────────────────────────────────────────────────────── */
router.post('/sync', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  // Find all shipped orders
  const shippedOrders = await Order.find({
    status: 'shipped',
    trackingCode: { $exists: true, $ne: null },
    shippedAt: { $gte: new Date(Date.now() - 7 * 86400000) },
  }).select('_id orderNumber trackingCode shippedAt');

  // In production: batch-call carrier API and update statuses
  // For now: return count of orders being monitored
  logger.info(`[Delivery] Sync requested — ${shippedOrders.length} orders in transit`);

  res.json({
    status: 'success',
    message: `Synced ${shippedOrders.length} shipments.`,
    monitored: shippedOrders.length,
    orders: shippedOrders.map(o => ({
      orderNumber: o.orderNumber,
      trackingCode: o.trackingCode,
      shippedAt: o.shippedAt,
    })),
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/delivery/pending  — Admin: orders ready to ship
   ──────────────────────────────────────────────────────────── */
router.get('/pending', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const orders = await Order.find({
    status: 'confirmed',
    trackingCode: { $exists: false },
  })
    .sort('confirmedAt')
    .limit(50)
    .select('orderNumber client.name client.phone client.city client.address total items confirmedAt');

  res.json({ status: 'success', count: orders.length, orders });
}));

module.exports = router;
module.exports.getZoneForCity = getZoneForCity;
