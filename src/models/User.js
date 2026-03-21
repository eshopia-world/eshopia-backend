'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, maxlength: 100 },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  phone:    { type: String, trim: true },
  city:     { type: String, trim: true },
  address:  { type: String, trim: true },

  role: { type: String, enum: ['client','agent','admin','superadmin'], default: 'client' },

  clientScore: {
    total:           { type: Number, default: 50 },
    ordersPlaced:    { type: Number, default: 0 },
    ordersDelivered: { type: Number, default: 0 },
    ordersRefused:   { type: Number, default: 0 },
    totalSpent:      { type: Number, default: 0 },
    lastUpdated:     { type: Date },
  },

  loyaltyPoints: { type: Number, default: 0 },
  isActive:      { type: Boolean, default: true },
  isBanned:      { type: Boolean, default: false },
  banReason:     { type: String },
  emailVerified: { type: Boolean, default: false },
  refreshToken:  { type: String, select: false },

  agentStats: {
    totalCalls: { type: Number, default: 0 },
    confirmed:  { type: Number, default: 0 },
    refused:    { type: Number, default: 0 },
    noAnswer:   { type: Number, default: 0 },
    rescheduled:{ type: Number, default: 0 },
  },

  lastLoginAt: { type: Date },
  lastLoginIp: { type: String },
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};
userSchema.methods.correctPassword = userSchema.methods.comparePassword;

userSchema.methods.generateAccessToken = function() {
  return jwt.sign(
    { id: this._id, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

userSchema.methods.generateRefreshToken = function() {
  const secret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET + '_refresh');
  return jwt.sign({ id: this._id }, secret, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
};

userSchema.methods.recomputeScore = function() {
  const { ordersPlaced, ordersDelivered, ordersRefused, totalSpent } = this.clientScore;
  if (ordersPlaced === 0) { this.clientScore.total = 50; return; }
  const dRate = ordersDelivered / ordersPlaced;
  const ds    = Math.round(dRate * 40);
  const ss    = totalSpent >= 5000 ? 30 : totalSpent >= 2000 ? 20 : totalSpent >= 500 ? 10 : 5;
  const vs    = ordersPlaced >= 20 ? 30 : ordersPlaced >= 10 ? 20 : ordersPlaced >= 5 ? 10 : 5;
  const pen   = Math.round((ordersRefused / ordersPlaced) * 30);
  this.clientScore.total     = Math.max(0, Math.min(100, ds + ss + vs - pen));
  this.clientScore.lastUpdated = new Date();
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
