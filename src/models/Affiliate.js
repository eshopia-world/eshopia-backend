'use strict';
const mongoose = require('mongoose');

// Individual click log
const clickSchema = new mongoose.Schema({
  ipHash:    { type: String },       // SHA256(ip) for privacy
  userAgent: { type: String },
  referrer:  { type: String },
  page:      { type: String },
  timestamp: { type: Date, default: Date.now },
  isDuplicate: { type: Boolean, default: false }, // same IP within 24h
}, { _id: false });

// Payout request
const payoutSchema = new mongoose.Schema({
  amount:    { type: Number, required: true, min: 200 },
  method:    { type: String, enum: ['virement', 'cih', 'barid', 'paypal'], required: true },
  iban:      { type: String },
  note:      { type: String },
  status:    { type: String, enum: ['pending', 'approved', 'paid', 'rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  adminNote: { type: String },
}, { _id: true });

const affiliateSchema = new mongoose.Schema({
  // ── Link to user account ─────────────────────────────────
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  userName:  { type: String },
  userEmail: { type: String },

  // ── Referral code & link ─────────────────────────────────
  code:      { type: String, required: true, unique: true, uppercase: true },
  isActive:  { type: Boolean, default: true },

  // ── Stats ────────────────────────────────────────────────
  totalClicks:    { type: Number, default: 0 },
  uniqueClicks:   { type: Number, default: 0 }, // deduplicated
  totalOrders:    { type: Number, default: 0 },
  deliveredOrders: { type: Number, default: 0 },
  cancelledOrders: { type: Number, default: 0 },

  // ── Commission (MAD) ─────────────────────────────────────
  commissionRate:  { type: Number, default: 0.10 }, // 10%
  totalEarned:     { type: Number, default: 0 },    // lifetime
  pendingBalance:  { type: Number, default: 0 },    // orders not yet delivered
  availableBalance: { type: Number, default: 0 },   // ready to withdraw
  totalPaidOut:    { type: Number, default: 0 },

  // ── Recent clicks (last 100 for fraud analysis) ──────────
  recentClicks: { type: [clickSchema], select: false },

  // ── Fraud detection ──────────────────────────────────────
  fraudScore: { type: Number, default: 0 }, // 0-100
  fraudFlags: [{ type: String }],
  autoSuspended: { type: Boolean, default: false },
  lastFraudCheck: { type: Date },

  // ── Payout history ───────────────────────────────────────
  payouts: [payoutSchema],

  // ── Performance tracking ──────────────────────────────────
  rank:        { type: Number },
  tier:        { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },

  // Monthly stats (last 6 months)
  monthlyStats: [{
    month:       { type: String }, // YYYY-MM
    clicks:      { type: Number, default: 0 },
    orders:      { type: Number, default: 0 },
    commission:  { type: Number, default: 0 },
  }],

  createdAt: { type: Date, default: Date.now },
});

// ── Indexes ──────────────────────────────────────────────────
affiliateSchema.index({ code: 1 });
affiliateSchema.index({ userId: 1 });
affiliateSchema.index({ availableBalance: -1 });
affiliateSchema.index({ totalEarned: -1 }); // for leaderboard
affiliateSchema.index({ fraudScore: -1 });

// ── Compute tier based on performance ─────────────────────────
affiliateSchema.methods.updateTier = function() {
  const earned = this.totalEarned;
  if (earned >= 10000) this.tier = 'platinum';
  else if (earned >= 5000) this.tier = 'gold';
  else if (earned >= 1000) this.tier = 'silver';
  else this.tier = 'bronze';
};

module.exports = mongoose.model('Affiliate', affiliateSchema);
