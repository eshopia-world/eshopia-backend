'use strict';
const express = require('express');
const Order   = require('../models/Order');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   GET /api/tracking/:orderNumber  — Public order tracking
   ──────────────────────────────────────────────────────────── */
router.get('/:orderNumber', asyncHandler(async (req, res, next) => {
  const on = req.params.orderNumber.toUpperCase();

  const order = await Order.findOne({ orderNumber: on })
    .select('orderNumber status lifecycle client.name client.city deliveryFee total items createdAt confirmedAt shippedAt deliveredAt trackingCode');

  if (!order) return next(new AppError('Order not found. Check your order number.', 404));

  // Build clean timeline for frontend
  const steps = [
    { key: 'pending',   label: 'Commande reçue',   icon: '📦', done: true },
    { key: 'confirmed', label: 'Commande confirmée', icon: '✅', done: ['confirmed','shipped','delivered'].includes(order.status) },
    { key: 'shipped',   label: 'En livraison',       icon: '🚚', done: ['shipped','delivered'].includes(order.status) },
    { key: 'delivered', label: 'Livré',               icon: '🎉', done: order.status === 'delivered' },
  ];

  // Handle refused/cancelled
  const isCancelled = ['refused','cancelled'].includes(order.status);

  res.json({
    status: 'success',
    tracking: {
      orderNumber:    order.orderNumber,
      status:         order.status,
      isCancelled,
      clientName:     order.client.name,
      city:           order.client.city,
      total:          order.total,
      itemCount:      order.items.reduce((s, i) => s + i.qty, 0),
      steps,
      trackingCode:   order.trackingCode,
      timeline:       order.lifecycle,
      createdAt:      order.createdAt,
      confirmedAt:    order.confirmedAt,
      shippedAt:      order.shippedAt,
      deliveredAt:    order.deliveredAt,
    },
  });
}));

module.exports = router;
