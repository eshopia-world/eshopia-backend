'use strict';
const express = require('express');
const Vendor  = require('../models/Vendor');
const Product = require('../models/Product');
const Order   = require('../models/Order');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const router  = express.Router();

/* POST /api/marketplace/register */
router.post('/register', protect, asyncHandler(async (req, res) => {
  const existing = await Vendor.findOne({ userId: req.user._id });
  if (existing) return res.status(409).json({ status:'fail', message:'Already registered.' });
  const { shopName, shopDesc, phone, city, category, bankName, bankAccount, iban } = req.body;
  if (!shopName) return res.status(400).json({ status:'fail', message:'Shop name required.' });
  const vendor = await Vendor.create({
    userId: req.user._id, userName: req.user.name, userEmail: req.user.email,
    email: req.user.email, shopName, shopDesc, phone, city, category,
    bankInfo: { accountName:bankName, iban, bank:bankAccount },
  });
  res.status(201).json({ status:'success', message:'Application submitted. Approval within 24h.', vendor:{ id:vendor._id, shopName:vendor.shopName, status:vendor.status } });
}));

/* GET /api/marketplace/stats */
router.get('/stats', protect, asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not registered as vendor.' });
  const products = await Product.find({ vendorId: vendor._id }).lean();
  res.json({ status:'success', vendor, productCount: products.length });
}));

/* GET /api/marketplace/products */
router.get('/products', protect, asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not found.' });
  const products = await Product.find({ vendorId: vendor._id }).lean();
  res.json({ status:'success', products });
}));

/* POST /api/marketplace/products */
router.post('/products', protect, asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id, status:'approved' });
  if (!vendor) return res.status(403).json({ status:'fail', message:'Vendor account not approved.' });
  const product = await Product.create({ ...req.body, vendorId: vendor._id, vendorName: vendor.shopName });
  res.status(201).json({ status:'success', product });
}));

/* PUT /api/marketplace/products/:id */
router.put('/products/:id', protect, asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not found.' });
  const product = await Product.findOneAndUpdate({ _id:req.params.id, vendorId:vendor._id }, req.body, { new:true });
  if (!product) return res.status(404).json({ status:'fail', message:'Product not found.' });
  res.json({ status:'success', product });
}));

/* GET /api/marketplace/orders */
router.get('/orders', protect, asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not found.' });
  const products = await Product.find({ vendorId: vendor._id }).select('_id').lean();
  const productIds = products.map(p => p._id);
  const orders = await Order.find({ 'items.productId':{ $in:productIds } }).sort('-createdAt').limit(50).lean();
  res.json({ status:'success', orders });
}));

/* GET /api/marketplace/all — Admin */
router.get('/all', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const vendors = await Vendor.find().sort('-createdAt').lean();
  res.json({ status:'success', vendors });
}));

/* PUT /api/marketplace/:id/approve — Admin */
router.put('/:id/approve', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(req.params.id, { status:'approved', approvedAt:new Date() }, { new:true });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not found.' });
  res.json({ status:'success', vendor });
}));

/* PUT /api/marketplace/:id/reject — Admin */
router.put('/:id/reject', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(req.params.id, { status:'rejected' }, { new:true });
  if (!vendor) return res.status(404).json({ status:'fail', message:'Not found.' });
  res.json({ status:'success', vendor });
}));

module.exports = router;
