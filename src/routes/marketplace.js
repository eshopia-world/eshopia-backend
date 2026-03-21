'use strict';
const express = require('express');
const Vendor  = require('../models/Vendor');
const Product = require('../models/Product');
const Order   = require('../models/Order');
const User    = require('../models/User');
const { AppError, asyncHandler }  = require('../middleware/errorHandler');
const { protect, restrictTo }     = require('../middleware/auth');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   POST /api/marketplace/register  — Become a vendor
   ──────────────────────────────────────────────────────────── */
router.post('/register', protect, asyncHandler(async (req, res, next) => {
  const existing = await Vendor.findOne({ userId: req.user._id });
  if (existing) {
    return next(new AppError('You already have a vendor account.', 409));
  }

  const { shopName, shopDesc, phone, city, bankName, bankAccount, iban } = req.body;
  if (!shopName) return next(new AppError('Shop name is required.', 400));

  const vendor = await Vendor.create({
    userId:    req.user._id,
    userName:  req.user.name,
    userEmail: req.user.email,
    shopName,
    shopDesc,
    phone:     phone || req.user.phone,
    city,
    bankInfo: { accountName: bankName, iban, bank: bankAccount },
    status: 'pending', // admin must approve
  });

  res.status(201).json({
    status:  'success',
    message: 'Vendor application submitted. Awaiting approval.',
    vendor: { _id: vendor._id, shopName: vendor.shopName, status: vendor.status },
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/marketplace/stats  — Vendor: own dashboard stats
   ──────────────────────────────────────────────────────────── */
router.get('/stats', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return next(new AppError('Vendor account not found.', 404));

  const [products, orderStats, revenueData] = await Promise.all([
    Product.countDocuments({ vendorId: vendor._id, isActive: true }),
    Order.aggregate([
      { $match: { 'items.vendorId': vendor._id } },
      { $group: {
        _id: '$status',
        count:   { $sum: 1 },
        revenue: { $sum: '$total' },
      }},
    ]),
    // Monthly revenue (last 6 months)
    Order.aggregate([
      { $match: {
        'items.vendorId': vendor._id,
        status: 'delivered',
        createdAt: { $gte: new Date(Date.now() - 180 * 86400000) },
      }},
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        revenue: { $sum: '$total' },
        orders:  { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ]);

  const statsMap = Object.fromEntries(orderStats.map(s => [s._id, s]));
  const delivered = statsMap.delivered || { count: 0, revenue: 0 };

  res.json({
    status: 'success',
    vendor: {
      _id:       vendor._id,
      shopName:  vendor.shopName,
      status:    vendor.status,
      balance:   vendor.availableBalance,
      pending:   vendor.pendingBalance,
    },
    stats: {
      totalProducts:  products,
      totalOrders:    orderStats.reduce((s, x) => s + x.count, 0),
      deliveredOrders: delivered.count,
      totalRevenue:   delivered.revenue,
      netRevenue:     Math.round(delivered.revenue * (1 - vendor.commissionRate)),
    },
    monthly: revenueData,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/marketplace/products  — Vendor: own products
   ──────────────────────────────────────────────────────────── */
router.get('/products', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return next(new AppError('Vendor account not found.', 404));

  const products = await Product.find({ vendorId: vendor._id }).sort('-createdAt');
  res.json({ status: 'success', products });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/marketplace/products  — Vendor: add product
   ──────────────────────────────────────────────────────────── */
router.post('/products', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id, status: 'approved' });
  if (!vendor) return next(new AppError('Approved vendor account required.', 403));

  const product = await Product.create({
    ...req.body,
    vendorId:   vendor._id,
    vendorName: vendor.shopName,
    isActive:   false, // Admin reviews before going live
  });

  res.status(201).json({
    status:  'success',
    message: 'Product submitted for review.',
    product,
  });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/marketplace/products/:id  — Vendor: edit product
   ──────────────────────────────────────────────────────────── */
router.put('/products/:id', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return next(new AppError('Vendor account not found.', 404));

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, vendorId: vendor._id },
    req.body,
    { new: true, runValidators: true }
  );
  if (!product) return next(new AppError('Product not found.', 404));
  res.json({ status: 'success', product });
}));

/* ────────────────────────────────────────────────────────────
   DELETE /api/marketplace/products/:id  — Vendor: remove
   ──────────────────────────────────────────────────────────── */
router.delete('/products/:id', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return next(new AppError('Vendor account not found.', 404));

  await Product.findOneAndUpdate(
    { _id: req.params.id, vendorId: vendor._id },
    { isActive: false }
  );
  res.json({ status: 'success', message: 'Product removed.' });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/marketplace/orders  — Vendor: own orders
   ──────────────────────────────────────────────────────────── */
router.get('/orders', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return next(new AppError('Vendor account not found.', 404));

  const { page = 1, limit = 25, status } = req.query;
  const filter = { 'items.vendorId': vendor._id };
  if (status) filter.status = status;

  const orders = await Order.find(filter)
    .sort('-createdAt')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  res.json({ status: 'success', orders });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/marketplace/settings  — Vendor: update settings
   ──────────────────────────────────────────────────────────── */
router.put('/settings', protect, asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findOneAndUpdate(
    { userId: req.user._id },
    { shopName: req.body.shopName, shopDesc: req.body.shopDesc, phone: req.body.phone },
    { new: true }
  );
  if (!vendor) return next(new AppError('Vendor account not found.', 404));
  res.json({ status: 'success', vendor });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/marketplace/all  — Admin: list all vendors
   ──────────────────────────────────────────────────────────── */
router.get('/all', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const vendors = await Vendor.find(filter).sort('-createdAt');
  res.json({ status: 'success', vendors });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/marketplace/:id/approve  — Admin: approve vendor
   ──────────────────────────────────────────────────────────── */
router.put('/:id/approve', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findByIdAndUpdate(
    req.params.id,
    { status: 'approved' },
    { new: true }
  );
  if (!vendor) return next(new AppError('Vendor not found.', 404));
  res.json({ status: 'success', vendor });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/marketplace/:id/reject  — Admin: reject vendor
   ──────────────────────────────────────────────────────────── */
router.put('/:id/reject', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const vendor = await Vendor.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected' },
    { new: true }
  );
  if (!vendor) return next(new AppError('Vendor not found.', 404));
  res.json({ status: 'success', vendor });
}));

module.exports = router;
