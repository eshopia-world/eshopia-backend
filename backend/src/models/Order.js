'use strict';
const mongoose = require('mongoose');
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, default: () => `ESH-${nanoid()}` },
  client: {
    name:    { type: String, required: true },
    phone:   { type: String, required: true },
    city:    { type: String, required: true },
    address: { type: String, required: true },
    notes:   { type: String },
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  items: [{
    productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    qty:         { type: Number, required: true, min: 1 },
    price:       { type: Number, required: true },
    _id: false,
  }],
  subtotal:    { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  total:       { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending','confirmed','shipped','delivered','refused','cancelled'],
    default: 'pending',
  },
  lifecycle: [{
    status:    { type: String },
    note:      { type: String },
    agentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    agentName: { type: String },
    timestamp: { type: Date, default: Date.now },
    _id: false,
  }],
  assignedAgent:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt:      { type: Date },
  shippedAt:        { type: Date },
  deliveredAt:      { type: Date },
  refusedAt:        { type: Date },
  trackingCode:     { type: String },
  affiliateCode:    { type: String },
  affiliateId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate' },
  affiliateCommission: { type: Number, default: 0 },
  commissionStatus: { type: String, enum: ['none','pending','credited','cancelled'], default: 'none' },
  fraudScore:       { type: Number, default: 0 },
  fraudFlags:       [{ type: String }],
  isBlocked:        { type: Boolean, default: false },
  idempotencyKey:   { type: String, unique: true, sparse: true },
  source:           { type: String, default: 'web' },
  lang:             { type: String, default: 'fr' },
  clientIp:         { type: String },
}, { timestamps: true });

orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'client.phone': 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ affiliateCode: 1 });

orderSchema.methods.addLifecycleEvent = function(status, note, agentId, agentName) {
  this.lifecycle.push({ status, note, agentId, agentName });
  this.status = status;
  const now = new Date();
  if (status === 'confirmed') this.confirmedAt = now;
  if (status === 'shipped')   this.shippedAt   = now;
  if (status === 'delivered') this.deliveredAt = now;
  if (status === 'refused')   this.refusedAt   = now;
};

module.exports = mongoose.model('Order', orderSchema);
