'use strict';
const mongoose = require('mongoose');

const affiliateSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  userName:  { type: String },
  userEmail: { type: String },
  code:      { type: String, required: true, unique: true, uppercase: true },
  isActive:  { type: Boolean, default: true },
  totalClicks:    { type: Number, default: 0 },
  uniqueClicks:   { type: Number, default: 0 },
  totalOrders:    { type: Number, default: 0 },
  deliveredOrders:{ type: Number, default: 0 },
  cancelledOrders:{ type: Number, default: 0 },
  commissionRate: { type: Number, default: 0.10 },
  totalEarned:    { type: Number, default: 0 },
  pendingBalance: { type: Number, default: 0 },
  availableBalance:{ type: Number, default: 0 },
  totalPaidOut:   { type: Number, default: 0 },
  fraudScore:     { type: Number, default: 0 },
  fraudFlags:     [String],
  autoSuspended:  { type: Boolean, default: false },
  tier: { type: String, enum: ['bronze','silver','gold','platinum'], default: 'bronze' },
  payouts: [{
    amount:      { type: Number, required: true },
    method:      { type: String, enum: ['virement','cih','barid','paypal'], required: true },
    iban:        { type: String },
    status:      { type: String, enum: ['pending','approved','paid','rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
  }],
  createdAt: { type: Date, default: Date.now },
});

affiliateSchema.index({ code: 1 });
affiliateSchema.index({ userId: 1 });
affiliateSchema.index({ totalEarned: -1 });

affiliateSchema.methods.updateTier = function() {
  const e = this.totalEarned;
  if (e >= 10000) this.tier = 'platinum';
  else if (e >= 5000) this.tier = 'gold';
  else if (e >= 1000) this.tier = 'silver';
  else this.tier = 'bronze';
};

module.exports = mongoose.model('Affiliate', affiliateSchema);
