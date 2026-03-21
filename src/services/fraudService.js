'use strict';
const Order     = require('../models/Order');
const Affiliate = require('../models/Affiliate');
const logger    = require('../utils/logger');

/* ============================================================
   E-SHOPIA Fraud Detection Service
   Scores orders 0-100 (higher = more suspicious)
   Auto-blocks at score >= 80, flags for review at >= 50
   ============================================================ */

const fraudService = {

  /* ── Score an incoming order ─────────────────────────────── */
  async scoreOrder({ phone, ip, total, affiliateCode }) {
    const flags = [];
    let score = 0;

    try {
      // ── 1. Phone: check refusal history ─────────────────
      const phoneOrders = await Order.find({ 'client.phone': phone })
        .sort('-createdAt')
        .limit(20)
        .select('status createdAt');

      const phoneTotal    = phoneOrders.length;
      const phoneRefused  = phoneOrders.filter(o => o.status === 'refused').length;
      const phoneRecent   = phoneOrders.filter(o =>
        new Date() - new Date(o.createdAt) < 24 * 60 * 60 * 1000
      ).length;

      if (phoneTotal > 0) {
        const refusalRate = phoneRefused / phoneTotal;
        if (refusalRate > 0.7) { score += 40; flags.push('HIGH_REFUSAL_RATE'); }
        else if (refusalRate > 0.5) { score += 20; flags.push('MEDIUM_REFUSAL_RATE'); }
      }
      if (phoneRecent >= 3) { score += 30; flags.push('MULTIPLE_ORDERS_SAME_DAY'); }

      // ── 2. IP: check order velocity ──────────────────────
      if (ip && ip !== '::1' && ip !== '127.0.0.1') {
        const ipOrders = await Order.countDocuments({
          clientIp: ip,
          createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
        });
        if (ipOrders >= 5) { score += 35; flags.push('IP_VELOCITY_HIGH'); }
        else if (ipOrders >= 3) { score += 15; flags.push('IP_VELOCITY_MEDIUM'); }
      }

      // ── 3. Suspicious total ──────────────────────────────
      if (total > 5000) { score += 10; flags.push('HIGH_VALUE_ORDER'); }

      // ── 4. Affiliate self-referral attempt ───────────────
      if (affiliateCode) {
        const aff = await Affiliate.findOne({ code: affiliateCode.toUpperCase() })
          .select('fraudScore autoSuspended');
        if (aff?.autoSuspended) { score += 20; flags.push('SUSPENDED_AFFILIATE_CODE'); }
        if (aff?.fraudScore > 70) { score += 10; flags.push('HIGH_RISK_AFFILIATE'); }
      }

      const isBlocked = score >= 80;
      if (isBlocked) {
        logger.warn(`[Fraud] Order BLOCKED — phone: ${phone} | IP: ${ip} | score: ${score} | flags: ${flags.join(', ')}`);
      } else if (score >= 50) {
        logger.info(`[Fraud] Order FLAGGED — phone: ${phone} | score: ${score} | flags: ${flags.join(', ')}`);
      }

      return { fraudScore: score, fraudFlags: flags, isBlocked };
    } catch (err) {
      logger.error(`[Fraud] Scoring error: ${err.message}`);
      return { fraudScore: 0, fraudFlags: [], isBlocked: false };
    }
  },

  /* ── Check affiliate click patterns ─────────────────────── */
  async checkAffiliateClicks(affiliateId) {
    try {
      const affiliate = await Affiliate.findById(affiliateId).select('+recentClicks');
      if (!affiliate?.recentClicks?.length) return;

      const flags = [...(affiliate.fraudFlags || [])];
      let score = affiliate.fraudScore || 0;

      const clicks = affiliate.recentClicks.slice(-100);
      const now = Date.now();
      const lastHourClicks = clicks.filter(c => now - new Date(c.timestamp) < 3600000);

      // Click velocity > 50/hour
      if (lastHourClicks.length > 50) {
        score = Math.min(100, score + 25);
        if (!flags.includes('CLICK_VELOCITY')) flags.push('CLICK_VELOCITY');
      }

      // All clicks from same IP
      const uniqueIps = new Set(clicks.map(c => c.ipHash)).size;
      const ipConcentration = 1 - (uniqueIps / clicks.length);
      if (ipConcentration > 0.9 && clicks.length > 20) {
        score = Math.min(100, score + 30);
        if (!flags.includes('SINGLE_IP_PATTERN')) flags.push('SINGLE_IP_PATTERN');
      }

      // Check order-to-click ratio (abuse: many orders, few organic clicks)
      const clickToOrderRatio = affiliate.totalOrders / Math.max(affiliate.uniqueClicks, 1);
      if (clickToOrderRatio > 0.8 && affiliate.totalOrders > 10) {
        score = Math.min(100, score + 20);
        if (!flags.includes('SUSPICIOUS_CONVERSION_RATE')) flags.push('SUSPICIOUS_CONVERSION_RATE');
      }

      // High cancellation rate
      const cancelRate = affiliate.cancelledOrders / Math.max(affiliate.totalOrders, 1);
      if (cancelRate > 0.6 && affiliate.totalOrders > 5) {
        score = Math.min(100, score + 25);
        if (!flags.includes('HIGH_CANCEL_RATE')) flags.push('HIGH_CANCEL_RATE');
      }

      const shouldSuspend = score >= 70;

      await Affiliate.findByIdAndUpdate(affiliateId, {
        fraudScore: score,
        fraudFlags: flags,
        autoSuspended: shouldSuspend,
        lastFraudCheck: new Date(),
        ...(shouldSuspend && { isActive: false }),
      });

      if (shouldSuspend) {
        logger.warn(`[Fraud] Affiliate AUTO-SUSPENDED: ${affiliateId} | score: ${score} | flags: ${flags.join(', ')}`);
      }
    } catch (err) {
      logger.error(`[Fraud] Affiliate check error: ${err.message}`);
    }
  },

  /* ── Daily fraud audit (called by scheduler) ─────────────── */
  async dailyAudit() {
    try {
      const affiliates = await Affiliate.find({ isActive: true })
        .select('_id fraudScore totalOrders cancelledOrders uniqueClicks');

      for (const aff of affiliates) {
        await this.checkAffiliateClicks(aff._id);
      }

      logger.info(`[Fraud] Daily audit complete — checked ${affiliates.length} affiliates`);
    } catch (err) {
      logger.error(`[Fraud] Daily audit error: ${err.message}`);
    }
  },
};

module.exports = fraudService;
