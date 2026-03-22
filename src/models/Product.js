'use strict';
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  sku:      { type: String, unique: true, sparse: true },
  name:     { type: String, required: true, trim: true },
  name_ar:  { type: String, trim: true },
  name_en:  { type: String, trim: true },
  desc:     { type: String, trim: true },
  desc_ar:  { type: String, trim: true },
  desc_en:  { type: String, trim: true },
  cat:      { type: String, required: true, trim: true },
  tags:     [String],
  price:    { type: Number, required: true, min: 0 },
  oldPrice: { type: Number, min: 0 },
  cost:     { type: Number, min: 0 },
  img:      { type: String, default: '📦' },
  images:   [String],
  stock:    { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  badge:    { type: String, enum: ['top','new','flash',''], default: '' },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  sold:     { type: Number, default: 0 },
  views:    { type: Number, default: 0 },
  rating:   { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  flashDeal: {
    isActive:   { type: Boolean, default: false },
    endTime:    { type: Date },
    flashPrice: { type: Number },
  },
  slug: { type: String, unique: true, sparse: true },
}, { timestamps: true });

productSchema.index({ cat: 1, isActive: 1 });
productSchema.index({ isActive: 1, sold: -1 });
productSchema.index({ name: 'text', desc: 'text', tags: 'text' });
productSchema.index({ 'flashDeal.isActive': 1 });

productSchema.virtual('discount').get(function() {
  if (!this.oldPrice || !this.price) return 0;
  return Math.round((1 - this.price / this.oldPrice) * 100);
});

productSchema.virtual('effectivePrice').get(function() {
  if (this.flashDeal?.isActive && this.flashDeal?.flashPrice && new Date() < this.flashDeal.endTime) {
    return this.flashDeal.flashPrice;
  }
  return this.price;
});

productSchema.set('toJSON', { virtuals: true });
module.exports = mongoose.model('Product', productSchema);
