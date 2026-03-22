'use strict';
const express = require('express');
const Order   = require('../models/Order');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const router  = express.Router();

const ZONES = {
  express:  { name:'Express 24h',  cities:['Casablanca','Rabat','Marrakech'], fee:0, days:1 },
  standard: { name:'Standard 48h', cities:['Fès','Fes','Tanger','Agadir','Meknès','Oujda','Kénitra','Tétouan','Mohammedia'], fee:0, days:2 },
  national: { name:'National 72h', cities:[], fee:30, days:3 },
};

function getZone(city) {
  if (!city) return { ...ZONES.national, key:'national' };
  const c = city.trim().toLowerCase();
  for (const [key, zone] of Object.entries(ZONES)) {
    if (zone.cities.some(z => z.toLowerCase() === c)) return { ...zone, key };
  }
  return { ...ZONES.national, key:'national' };
}

/* GET /api/delivery/zones */
router.get('/zones', (req, res) => {
  const { city, subtotal } = req.query;
  const zone = getZone(city);
  const FREE_FROM = parseFloat(process.env.FREE_DELIVERY_THRESHOLD) || 129;
  const sub  = parseFloat(subtotal) || 0;
  const fee  = sub >= FREE_FROM ? 0 : zone.fee;
  res.json({ status:'success', zone:{ name:zone.name, city:city||'Autre', fee, isFree:fee===0, days:zone.days, freeFrom:FREE_FROM } });
});

/* GET /api/delivery/pending */
router.get('/pending', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const orders = await Order.find({ status:'confirmed', trackingCode:{ $exists:false } })
    .sort('confirmedAt').limit(50)
    .select('orderNumber client.name client.phone client.city client.address total confirmedAt');
  res.json({ status:'success', count:orders.length, orders });
}));

/* POST /api/delivery/create */
router.post('/create', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const { orderId, provider='amana' } = req.body;
  const order = await Order.findById(orderId);
  if (!order) return res.status(404).json({ status:'fail', message:'Order not found.' });
  if (order.status !== 'confirmed') return res.status(400).json({ status:'fail', message:'Order must be confirmed.' });
  const trackingCode = `${provider.toUpperCase().slice(0,3)}-${Date.now().toString(36).toUpperCase()}`;
  order.trackingCode = trackingCode;
  order.addLifecycleEvent('shipped', `Shipment via ${provider}. Tracking: ${trackingCode}`, req.user._id, req.user.name);
  await order.save();
  res.json({ status:'success', trackingCode, orderNumber:order.orderNumber });
}));

module.exports = router;
