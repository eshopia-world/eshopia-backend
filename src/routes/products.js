'use strict';
const express = require('express');
const Product = require('../models/Product');
const Order   = require('../models/Order');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const router  = express.Router();

/* GET /api/products */
router.get('/', asyncHandler(async (req, res) => {
  const { cat, search, sort='-sold', limit=20, page=1, badge, minPrice, maxPrice } = req.query;
  const filter = { isActive: true };
  if (cat && cat !== 'Tout') filter.cat = cat;
  if (badge) filter.badge = badge;
  if (search) filter.$text = { $search: search };
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = +minPrice;
    if (maxPrice) filter.price.$lte = +maxPrice;
  }
  const products = await Product.find(filter).sort(sort).limit(+limit).skip((+page-1)*+limit).select('-cost').lean();
  const total    = await Product.countDocuments(filter);
  res.json({ status:'success', total, products });
}));

/* GET /api/products/flash */
router.get('/flash', asyncHandler(async (req, res) => {
  const now = new Date();
  const products = await Product.find({
    isActive: true,
    'flashDeal.isActive': true,
    'flashDeal.endTime': { $gt: now },
  }).sort('-sold').limit(12).lean();
  // If no flash products in DB, return badge:'flash' products
  const result = products.length ? products :
    await Product.find({ isActive:true, badge:'flash' }).sort('-sold').limit(6).lean();
  // End of day timestamp
  const endOfDay = new Date(); endOfDay.setHours(23,59,59,0);
  const flashEndTs = products[0]?.flashDeal?.endTime?.getTime() || endOfDay.getTime();
  res.json({ status:'success', products:result, flashEndTs });
}));

/* GET /api/products/recommendations/:id */
router.get('/recommendations/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ status:'fail', message:'Product not found.' });
  // Co-purchase analysis
  const orders = await Order.find({ 'items.productId': product._id, status:'delivered' }).select('items').lean();
  const coIds = {};
  for (const order of orders) {
    for (const item of order.items) {
      if (String(item.productId) !== String(product._id)) {
        coIds[item.productId] = (coIds[item.productId] || 0) + 1;
      }
    }
  }
  const topIds = Object.entries(coIds).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id])=>id);
  let related = await Product.find({ _id:{ $in:topIds }, isActive:true }).lean();
  // Fallback to same category
  if (related.length < 4) {
    const extra = await Product.find({ cat:product.cat, _id:{ $ne:product._id, $nin:topIds }, isActive:true }).sort('-sold').limit(4-related.length).lean();
    related = [...related, ...extra];
  }
  res.json({ status:'success', recommendations:related });
}));

/* GET /api/products/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { $inc:{ views:1 } }, { new:true }).select('-cost');
  if (!product) return res.status(404).json({ status:'fail', message:'Product not found.' });
  res.json({ status:'success', product });
}));

/* POST /api/products */
router.post('/', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json({ status:'success', product });
}));

/* PUT /api/products/:id */
router.put('/:id', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true });
  if (!product) return res.status(404).json({ status:'fail', message:'Product not found.' });
  res.json({ status:'success', product });
}));

/* DELETE /api/products/:id */
router.delete('/:id', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  await Product.findByIdAndUpdate(req.params.id, { isActive:false });
  res.json({ status:'success', message:'Product deactivated.' });
}));

module.exports = router;
