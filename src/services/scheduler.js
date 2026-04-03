'use strict';
const cron         = require('node-cron');
const Order        = require('../models/Order');
const Product      = require('../models/Product');
const fraudService = require('./fraudService');
const notifyService= require('./notifyService');
const logger       = require('../utils/logger');

function scheduledJobs() {
  // ── Daily affiliate fraud audit — 2:00 AM ──
  cron.schedule('0 2 * * *', async () => {
    logger.info('[Scheduler] Running daily affiliate fraud audit...');
    await fraudService.auditAllAffiliates();
  });

  // ── Low stock alerts — every 6 hours ──
  cron.schedule('0 */6 * * *', async () => {
    try {
      const low = await Product.find({ stock: { $lte: 5, $gt: 0 }, isActive: true })
        .select('name stock').limit(20);
      if (low.length) await notifyService.lowStockAlert(low);
    } catch (err) {
      logger.error('[Scheduler] Low stock check error:', err.message);
    }
  });

  // ── Auto-cancel stale pending orders — 3:00 AM ──
  cron.schedule('0 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const stale = await Order.find({ status: 'pending', createdAt: { $lt: cutoff } });

      for (const order of stale) {
        // Restore stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stock: item.qty },
          });
        }
        order.addLifecycleEvent('cancelled', 'Auto-cancelled: no confirmation after 48h');
        await order.save();
      }

      if (stale.length) {
        logger.info(`[Scheduler] Auto-cancelled ${stale.length} stale orders`);
      }
    } catch (err) {
      logger.error('[Scheduler] Auto-cancel error:', err.message);
    }
  });

  logger.info('[Scheduler] All cron jobs registered ✅');
}

module.exports = { scheduledJobs };
