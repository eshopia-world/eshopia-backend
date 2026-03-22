'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  phone:    { type: String, trim: true },
  city:     { type: String, trim: true },
  role:     { type: String, enum: ['client','agent','admin','superadmin'], default: 'client' },
  loyaltyPoints: { type: Number, default: 0 },
  clientScore: {
    total:           { type: Number, default: 50 },
    ordersPlaced:    { type: Number, default: 0 },
    ordersDelivered: { type: Number, default: 0 },
    ordersRefused:   { type: Number, default: 0 },
    totalSpent:      { type: Number, default: 0 },
  },
  isActive:      { type: Boolean, default: true },
  isBanned:      { type: Boolean, default: false },
  refreshToken:  { type: String, select: false },
  agentStats: {
    totalCalls: { type: Number, default: 0 },
    confirmed:  { type: Number, default: 0 },
    refused:    { type: Number, default: 0 },
  },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
