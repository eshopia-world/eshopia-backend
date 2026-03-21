'use strict';
const express = require('express');
const Product = require('../models/Product');
const Order   = require('../models/Order');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { protect, restrictTo }    = require('../middleware/auth');

const router = express.Router();

/* ────────────────────────────────────────────────────────────
   GET /api/products  — Public: list products with filters
   ──────────────────────────────────────────────────────────── */
router.get('/', asyncHandler(async (req, res) => {
  const {
    cat, search, badge, minPrice, maxPrice,
    sort = '-sold', page = 1, limit = 20,
    vendorId, featured,
  } = req.query;

  const filter = { isActive: true };
  if (cat && cat !== 'Tout')  filter.cat = new RegExp(cat, 'i');
  if (badge)                  filter.badge = badge;
  if (vendorId)               filter.vendorId = vendorId;
  if (featured === 'true')    filter.featured = true;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
  }
  if (search) {
    filter.$or = [
      { name:     new RegExp(search, 'i') },
      { name_ar:  new RegExp(search, 'i') },
      { name_en:  new RegExp(search, 'i') },
      { cat:      new RegExp(search, 'i') },
      { desc:     new RegExp(search, 'i') },
      { tags:     new RegExp(search, 'i') },
    ];
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('-desc -desc_ar -desc_en'), // omit long fields from list
    Product.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    total,
    pages: Math.ceil(total / parseInt(limit)),
    page:  parseInt(page),
    products,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/products/flash  — Flash deals (on sale items)
   ──────────────────────────────────────────────────────────── */
router.get('/flash', asyncHandler(async (req, res) => {
  const products = await Product.find({
    isActive:  true,
    old:       { $exists: true, $gt: 0 },
    stock:     { $gt: 0 },
  })
    .sort('-sold')
    .limit(12);

  const endTs = getOrSetFlashEnd();

  res.json({ status: 'success', products, flashEndTs: endTs });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/products/recommendations/:id  — Cross-sell / upsell
   ──────────────────────────────────────────────────────────── */
router.get('/recommendations/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.json({ status: 'success', products: [] });

  // 1. Same category (upsell)
  const sameCat = await Product.find({
    _id:      { $ne: product._id },
    cat:      product.cat,
    isActive: true,
    stock:    { $gt: 0 },
  }).sort('-sold').limit(4);

  // 2. Frequently bought together (from order history)
  const coOrdered = await Order.aggregate([
    { $match: { 'items.productId': product._id, status: { $in: ['delivered', 'confirmed'] } } },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $ne: product._id } } },
    { $group: { _id: '$items.productId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 4 },
  ]);

  const coIds = coOrdered.map(c => c._id);
  const coProducts = await Product.find({
    _id: { $in: coIds },
    isActive: true,
    stock: { $gt: 0 },
  });

  res.json({
    status: 'success',
    sameCat,
    frequently_bought: coProducts,
  });
}));

/* ────────────────────────────────────────────────────────────
   GET /api/products/:id  — Single product detail
   ──────────────────────────────────────────────────────────── */
router.get('/:id', asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product || !product.isActive) {
    return next(new AppError('Product not found.', 404));
  }
  // Increment view count (fire and forget)
  Product.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec();

  res.json({ status: 'success', product });
}));

/* ────────────────────────────────────────────────────────────
   POST /api/products  — Admin: create product
   ──────────────────────────────────────────────────────────── */
router.post('/', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const product = await Product.create(req.body);
  res.status(201).json({ status: 'success', product });
}));

/* ────────────────────────────────────────────────────────────
   PUT /api/products/:id  — Admin/Vendor: update product
   ──────────────────────────────────────────────────────────── */
router.put('/:id', protect, restrictTo('admin', 'superadmin', 'vendor'), asyncHandler(async (req, res, next) => {
  const filter = { _id: req.params.id };
  // Vendors can only edit their own products
  if (req.user.role === 'vendor') filter.vendorId = req.user._id;

  const product = await Product.findOneAndUpdate(filter, req.body, {
    new: true, runValidators: true,
  });
  if (!product) return next(new AppError('Product not found or unauthorized.', 404));
  res.json({ status: 'success', product });
}));

/* ────────────────────────────────────────────────────────────
   DELETE /api/products/:id  — Admin: soft delete
   ──────────────────────────────────────────────────────────── */
router.delete('/:id', protect, restrictTo('admin', 'superadmin'), asyncHandler(async (req, res, next) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id, { isActive: false }, { new: true }
  );
  if (!product) return next(new AppError('Product not found.', 404));
  res.json({ status: 'success', message: 'Product deactivated.' });
}));

/* ── Helpers ─────────────────────────────────────────────── */
let _flashEnd = null;
function getOrSetFlashEnd() {
  const now = Date.now();
  if (!_flashEnd || _flashEnd < now) {
    // Set flash deal to end at midnight + 20 hours from now
    _flashEnd = new Date();
    _flashEnd.setHours(23, 59, 59, 0);
    _flashEnd = _flashEnd.getTime();
  }
  return _flashEnd;
}

module.exports = router;
