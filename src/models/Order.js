'use strict';
const mongoose = require('mongoose');
const { customAlphabet } = require('nanoid');

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

const orderItemSchema = new mongoose.Schema({
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  productImg:  { type: String },
  qty:         { type: Number, required: true, min: 1 },
  price:       { type: Number, required: true },        // price at time of order
  vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
}, { _id: false });

// Lifecycle event for audit trail
const lifecycleEventSchema = new mongoose.Schema({
  status:   { type: String },
  note:     { type: String },
  agentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  agentName: { type: String },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  // ── Order number (human-readable) ────────────────────────
  orderNumber: {
    type: String,
    unique: true,
    default: () => `ESH-${nanoid()}`,
  },

  // ── Client info (no auth required for COD) ────────────────
  client: {
    name:    { type: String, required: true, trim: true },
    phone:   { type: String, required: true, trim: true },
    city:    { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    notes:   { type: String, trim: true },
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // if logged in
  },

  // ── Items ────────────────────────────────────────────────
  items:    { type: [orderItemSchema], required: true },

  // ── Financials ───────────────────────────────────────────
  subtotal:     { type: Number, required: true },
  deliveryFee:  { type: Number, default: 0 },
  total:        { type: Number, required: true },
  currency:     { type: String, default: 'MAD' },

  // ── Status lifecycle ─────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'refused', 'cancelled', 'returned'],
    default: 'pending',
  },
  lifecycle: [lifecycleEventSchema], // full audit trail

  // ── Agent assignment ──────────────────────────────────────
  assignedAgent:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedAgentName: { type: String },
  confirmedAt:       { type: Date },
  shippedAt:         { type: Date },
  deliveredAt:       { type: Date },
  refusedAt:         { type: Date },

  // ── Delivery ─────────────────────────────────────────────
  deliveryZone:      { type: String },
  deliveryDeadline:  { type: Date },
  trackingCode:      { type: String },

  // ── Affiliate tracking ────────────────────────────────────
  affiliateCode:       { type: String },
  affiliateId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate' },
  affiliateCommission: { type: Number, default: 0 },
  commissionStatus: {
    type: String,
    enum: ['none', 'pending', 'credited', 'paid', 'cancelled'],
    default: 'none',
  },

  // ── Anti-fraud fields ────────────────────────────────────
  clientIp:        { type: String },
  userAgent:       { type: String },
  fraudScore:      { type: Number, default: 0 }, // 0-100, higher = more suspicious
  fraudFlags:      [{ type: String }],
  isBlocked:       { type: Boolean, default: false },

  // ── Idempotency (prevent double submission) ───────────────
  idempotencyKey: { type: String, unique: true, sparse: true },

  // ── Metadata ─────────────────────────────────────────────
  source:     { type: String, default: 'web' }, // web | mobile | whatsapp
  lang:       { type: String, default: 'fr' },

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'client.phone': 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ assignedAgent: 1, status: 1 });
orderSchema.index({ affiliateCode: 1 });
orderSchema.index({ clientIp: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });

// ── Add lifecycle event helper ────────────────────────────────
orderSchema.methods.addLifecycleEvent = function(status, note, agentId, agentName) {
  this.lifecycle.push({ status, note, agentId, agentName });
  this.status = status;

  // Set specific timestamps
  const now = new Date();
  if (status === 'confirmed') this.confirmedAt = now;
  if (status === 'shipped')   this.shippedAt = now;
  if (status === 'delivered') this.deliveredAt = now;
  if (status === 'refused')   this.refusedAt = now;
};

module.exports = mongoose.model('Order', orderSchema);
