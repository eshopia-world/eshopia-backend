'use strict';
const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  userName:  { type: String },
  userEmail: { type: String },
  email:     { type: String, required: true },
  shopName:  { type: String, required: true, trim: true },
  shopDesc:  { type: String, trim: true },
  category:  { type: String },
  city:      { type: String },
  phone:     { type: String },
  status:    { type: String, enum: ['pending','approved','suspended','rejected'], default: 'pending' },
  approvedAt: { type: Date },
  platformFee:      { type: Number, default: 0.15 },
  commissionRate:   { type: Number, default: 0.15 },
  pendingBalance:   { type: Number, default: 0 },
  availableBalance: { type: Number, default: 0 },
  totalRevenue:     { type: Number, default: 0 },
  totalPaidOut:     { type: Number, default: 0 },
  totalOrders:      { type: Number, default: 0 },
  deliveredOrders:  { type: Number, default: 0 },
  bankInfo: {
    accountName: { type: String },
    iban:        { type: String },
    bank:        { type: String },
  },
  payoutRequests: [{
    amount:      { type: Number },
    status:      { type: String, enum: ['pending','paid','rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    paidAt:      { type: Date },
  }],
}, { timestamps: true });

vendorSchema.index({ userId: 1 });
vendorSchema.index({ status: 1 });
module.exports = mongoose.model('Vendor', vendorSchema);
