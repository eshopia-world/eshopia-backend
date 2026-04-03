'use strict';
const Order     = require('../models/Order');
const Affiliate = require('../models/Affiliate');
const logger    = require('../utils/logger');

/* ══════════════════════════════════════════════
   FRAUD SERVICE — Score orders & affiliates
   ══════════════════════════════════════════════ */

/* ── Score a new order (0-100, higher = more suspicious) ── */
async function scoreOrder(orderData) {
  let score = 0;
  const flags = [];

  const { phone, clientIp, affiliateCode } = orderData;

  try {
    // Check phone history
    if (phone) {
      const phoneOrders = await Order.find({ 'client.phone': phone })
        .sort('-createdAt').limit(20)
        .select('status createdAt');

      if (phoneOrders.length > 0) {
        const refused   = phoneOrders.filter(o => o.status === 'refused').length;
        const total     = phoneOrders.length;
        const refusalRate = refused / total;

        if (refusalRate >= 0.7)  { score += 40; flags.push('HIGH_REFUSAL_RATE'); }
        else if (refusalRate >= 0.5) { score += 20; flags.push('MEDIUM_REFUSAL_RATE'); }

        // Multiple orders same day
        const today = new Date(); today.setHours(0,0,0,0);
        const todayOrders = phoneOrders.filter(o => new Date(o.createdAt) >= today);
        if (todayOrders.length >= 3) { score += 30; flags.push('MULTIPLE_ORDERS_SAME_DAY'); }
      }
    }

    // Check IP velocity
    if (clientIp) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const ipOrders = await Order.countDocuments({
        clientIp,
        createdAt: { $gte: oneHourAgo },
      });
      if (ipOrders >= 5) { score += 35; flags.push('IP_VELOCITY_HIGH'); }
    }

    // High value order
    if ((orderData.total || 0) > 5000) { score += 10; flags.push('HIGH_VALUE_ORDER'); }

    // Affiliate code check
    if (affiliateCode) {
      const aff = await Affiliate.findOne({ code: affiliateCode.toUpperCase() });
      if (aff && (!aff.isActive || aff.autoSuspended)) {
        score += 20;
        flags.push('SUSPENDED_AFFILIATE_CODE');
      }
    }

  } catch (err) {
    logger.warn('[FraudService] scoreOrder error:', err.message);
  }

  return { score: Math.min(100, score), flags };
}

/* ── Daily affiliate fraud audit ── */
async function auditAllAffiliates() {
  logger.info('[FraudService] Starting daily affiliate fraud audit...');
  try {
    const affiliates = await Affiliate.find({ isActive: true }).select('+recentClicks');
    let suspended = 0;

    for (const aff of affiliates) {
      const result = await checkAffiliateClicks(aff._id);
      if (result?.suspended) suspended++;
    }

    logger.info(`[FraudService] Audit complete — ${suspended} affiliates suspended`);
  } catch (err) {
    logger.error('[FraudService] auditAllAffiliates error:', err.message);
  }
}

/* ── Check single affiliate for fraud ── */
async function checkAffiliateClicks(affiliateId) {
  try {
    const aff = await Affiliate.findById(affiliateId).select('+recentClicks');
    if (!aff) return null;

    let score = aff.fraudScore || 0;
    const flags = [...(aff.fraudFlags || [])];

    // Click velocity
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentClicks = (aff.recentClicks || []).filter(c => new Date(c.timestamp) >= oneHourAgo);
    if (recentClicks.length > 50) {
      score += 25;
      if (!flags.includes('CLICK_VELOCITY')) flags.push('CLICK_VELOCITY');
    }

    // Single IP dominance
    if (recentClicks.length > 10) {
      const ipCounts = {};
      recentClicks.forEach(c => { ipCounts[c.ipHash] = (ipCounts[c.ipHash] || 0) + 1; });
      const maxIpPct = Math.max(...Object.values(ipCounts)) / recentClicks.length;
      if (maxIpPct > 0.9) {
        score += 30;
        if (!flags.includes('SINGLE_IP_PATTERN')) flags.push('SINGLE_IP_PATTERN');
      }
    }

    // Cancel rate
    if (aff.totalOrders > 5) {
      const cancelRate = aff.cancelledOrders / aff.totalOrders;
      if (cancelRate > 0.6) {
        score += 25;
        if (!flags.includes('HIGH_CANCEL_RATE')) flags.push('HIGH_CANCEL_RATE');
      }
    }

    score = Math.min(100, score);
    const shouldSuspend = score >= 70 && !aff.autoSuspended;

    await Affiliate.findByIdAndUpdate(affiliateId, {
      fraudScore: score,
      fraudFlags: flags,
      lastFraudCheck: new Date(),
      ...(shouldSuspend ? { isActive: false, autoSuspended: true } : {}),
    });

    if (shouldSuspend) {
      logger.warn(`[FraudService] Affiliate ${aff.code} auto-suspended (score: ${score})`);
    }

    return { score, flags, suspended: shouldSuspend };
  } catch (err) {
    logger.warn('[FraudService] checkAffiliateClicks error:', err.message);
    return null;
  }
}

module.exports = { scoreOrder, auditAllAffiliates, checkAffiliateClicks };
