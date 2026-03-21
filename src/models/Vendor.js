'use strict';
const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  // ── Owner ────────────────────────────────────────────────
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  userName:  { type: String },
  email:     { type: String, required: true },
  userEmail: { type: String },

  // ── Shop info ────────────────────────────────────────────
  shopName:  { type: String, required: true, trim: true },
  shopDesc:  { type: String, trim: true },
  logo:      { type: String },
  category:  { type: String },
  city:      { type: String },
  phone:     { type: String },

  // ── Status ───────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'approved', 'suspended', 'rejected'],
    default: 'pending',
  },
  approvedAt:  { type: Date },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String },

  // ── Commission & financial ────────────────────────────────
  platformFee:     { type: Number, default: 0.15 }, // 15% platform fee
  commissionRate:  { type: Number, default: 0.15 }, // alias for platformFee
  pendingBalance:  { type: Number, default: 0 },    // awaiting escrow release
  availableBalance: { type: Number, default: 0 },   // ready to payout
  totalRevenue:    { type: Number, default: 0 },
  totalPaidOut:    { type: Number, default: 0 },

  // ── Performance ──────────────────────────────────────────
  totalOrders:    { type: Number, default: 0 },
  deliveredOrders: { type: Number, default: 0 },
  cancelledOrders: { type: Number, default: 0 },
  avgRating:      { type: Number, default: 0 },

  // ── Bank info for payouts ─────────────────────────────────
  bankInfo: {
    accountName: { type: String },
    iban:        { type: String },
    bank:        { type: String },
  },

  // ── Payout requests ──────────────────────────────────────
  payoutRequests: [{
    amount:      { type: Number },
    status:      { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    paidAt:      { type: Date },
  }],

  // ── Settings ─────────────────────────────────────────────
  autoAcceptOrders: { type: Boolean, default: false },
  deliveryDelay:    { type: Number, default: 3 }, // days

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────
vendorSchema.index({ userId: 1 });
  userName:  { type: String },
vendorSchema.index({ status: 1 });
vendorSchema.index({ totalRevenue: -1 });

module.exports = mongoose.model('Vendor', vendorSchema);
