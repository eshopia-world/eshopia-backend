'use strict';
const cron         = require('node-cron');
const fraudService = require('./fraudService');
const logger       = require('../utils/logger');

/* ============================================================
   E-SHOPIA — Scheduled Jobs
   Runs background tasks: fraud audits, low-stock checks, etc.
   ============================================================ */

function scheduledJobs() {

  // ── Daily fraud audit (2 AM Morocco time) ───────────────
  cron.schedule('0 2 * * *', async () => {
    logger.info('[Scheduler] Running daily fraud audit...');
    await fraudService.dailyAudit();
  }, { timezone: 'Africa/Casablanca' });

  // ── Low stock check (every 6 hours) ─────────────────────
  cron.schedule('0 */6 * * *', async () => {
    try {
      const Product      = require('../models/Product');
      const notifyService = require('./notifyService');
      const lowStock = await Product.find({ stock: { $lte: 5, $gt: 0 }, isActive: true });
      for (const p of lowStock) {
        await notifyService.lowStockAlert(p);
      }
      if (lowStock.length > 0) {
        logger.info(`[Scheduler] Low stock alert: ${lowStock.length} products`);
      }
    } catch (err) {
      logger.error(`[Scheduler] Low stock check error: ${err.message}`);
    }
  });

  // ── Auto-cancel stale pending orders (48h+) ─────────────
  cron.schedule('0 3 * * *', async () => {
    try {
      const Order = require('../models/Order');
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const stale = await Order.find({ status: 'pending', createdAt: { $lt: cutoff } });

      for (const order of stale) {
        order.addLifecycleEvent('cancelled', 'Auto-cancelled: no response after 48h');
        await order.save();
        // Restore stock
        for (const item of order.items) {
          await require('../models/Product').findByIdAndUpdate(
            item.productId, { $inc: { stock: item.qty } }
          );
        }
      }
      if (stale.length > 0) {
        logger.info(`[Scheduler] Auto-cancelled ${stale.length} stale orders`);
      }
    } catch (err) {
      logger.error(`[Scheduler] Auto-cancel error: ${err.message}`);
    }
  });

  logger.info('[Scheduler] All cron jobs initialized');
}

module.exports = { scheduledJobs };
