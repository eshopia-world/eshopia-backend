'use strict';
const express = require('express');
const Order   = require('../models/Order');
const { asyncHandler } = require('../middleware/auth');
const router  = express.Router();

/* GET /api/tracking/:orderNumber */
router.get('/:orderNumber', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber.toUpperCase() })
    .select('orderNumber status lifecycle client.city client.name total deliveryFee trackingCode confirmedAt shippedAt deliveredAt createdAt items')
    .lean();
  if (!order) return res.status(404).json({ status:'fail', message:'Order not found.' });
  res.json({
    status: 'success',
    tracking: {
      orderNumber:  order.orderNumber,
      status:       order.status,
      city:         order.client?.city,
      total:        order.total,
      itemCount:    order.items?.length,
      trackingCode: order.trackingCode,
      timeline:     order.lifecycle,
      confirmedAt:  order.confirmedAt,
      shippedAt:    order.shippedAt,
      deliveredAt:  order.deliveredAt,
      createdAt:    order.createdAt,
      isCancelled:  ['refused','cancelled'].includes(order.status),
    },
  });
}));

module.exports = router;
