'use strict';
const axios  = require('axios');
const logger = require('../utils/logger');

/* ============================================================
   E-SHOPIA — Notification Service
   WhatsApp Business API + SMS (InTouch Morocco)
   ============================================================ */

const WA_TOKEN    = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const ADMIN_WA    = process.env.ADMIN_WHATSAPP;

/* ── Core: Send WhatsApp message ─────────────────────────── */
async function sendWhatsApp(to, message) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    logger.info(`[Notify] WA not configured. Would send to ${to}: ${message.substring(0, 60)}...`);
    return;
  }
  // Normalize Moroccan number
  const phone = to.replace(/^0/, '212').replace(/\D/g, '');
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message },
      },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    logger.info(`[Notify] WA sent to ${phone}`);
  } catch (err) {
    logger.error(`[Notify] WA failed to ${phone}: ${err.response?.data?.error?.message || err.message}`);
  }
}

/* ── Core: Send SMS via InTouch Morocco ──────────────────── */
async function sendSMS(to, message) {
  if (!process.env.INTOUCH_API_KEY) {
    logger.info(`[Notify] SMS not configured. Would send to ${to}`);
    return;
  }
  const phone = to.replace(/^0/, '+212');
  try {
    await axios.post('https://api.intouchsms.ma/api/sms/send', {
      apiKey:  process.env.INTOUCH_API_KEY,
      sender:  process.env.INTOUCH_SENDER || 'ESHOPIA',
      to:      phone,
      message: message.substring(0, 160),
    });
    logger.info(`[Notify] SMS sent to ${phone}`);
  } catch (err) {
    logger.error(`[Notify] SMS failed to ${phone}: ${err.message}`);
  }
}

/* ── Notification templates ──────────────────────────────── */
const notifyService = {

  /* Order placed — notify client + admin */
  async orderPlaced(order) {
    const { client, orderNumber, total } = order;

    // Client notification
    const clientMsg =
      `✅ *Commande confirmée — E-Shopia Maroc*\n\n` +
      `Bonjour ${client.name} !\n` +
      `Votre commande *${orderNumber}* a bien été reçue.\n\n` +
      `💰 Total: *${total} DH* (paiement à la livraison)\n` +
      `🚚 Livraison: 24-48h\n\n` +
      `Notre équipe vous appellera pour confirmer. Merci de votre confiance ! 🙏`;

    await sendWhatsApp(client.phone, clientMsg);

    // Admin notification
    if (ADMIN_WA) {
      const items = order.items.map(i => `  • ${i.productName} x${i.qty}`).join('\n');
      const adminMsg =
        `🛒 *Nouvelle commande — E-Shopia*\n\n` +
        `📦 *${orderNumber}*\n` +
        `👤 ${client.name} | 📞 ${client.phone}\n` +
        `📍 ${client.city} — ${client.address}\n\n` +
        `${items}\n\n` +
        `💰 Total: *${total} DH* (COD)\n` +
        `⚠️ Score fraude: ${order.fraudScore || 0}`;
      await sendWhatsApp(ADMIN_WA, adminMsg);
    }
  },

  /* Order status updated */
  async orderStatusUpdated(order) {
    const { client, orderNumber, status } = order;

    const messages = {
      confirmed: `✅ *Commande confirmée !*\n\nBonjour ${client.name}, votre commande *${orderNumber}* a été confirmée.\n🚚 Livraison en cours de préparation. À bientôt !`,
      shipped:   `📦 *Commande expédiée !*\n\nBonjour ${client.name}, votre commande *${orderNumber}* est en route !\n🕐 Livraison attendue dans 24-48h.\n${order.trackingCode ? `Code suivi: ${order.trackingCode}` : ''}`,
      delivered: `🎉 *Commande livrée !*\n\nBonjour ${client.name}, votre commande *${orderNumber}* a été livrée.\nMerci pour votre achat ! ⭐ Laissez-nous un avis sur eshopia.ma`,
      refused:   `❌ *Commande refusée*\n\nBonjour ${client.name}, votre commande *${orderNumber}* a été annulée.\nPour toute question: wa.me/212702010303`,
      cancelled: `🚫 *Commande annulée*\n\nBonjour ${client.name}, votre commande *${orderNumber}* a été annulée à votre demande.`,
    };

    const msg = messages[status];
    if (msg) await sendWhatsApp(client.phone, msg);
  },

  /* Affiliate payout approved */
  async payoutApproved(affiliate, amount) {
    const msg =
      `💸 *Virement approuvé — E-Shopia Affilié*\n\n` +
      `Bonjour ${affiliate.userName} !\n` +
      `Votre demande de retrait de *${amount} DH* a été approuvée.\n` +
      `⏱ Traitement sous 24-48h. Merci !`;
    // Would send to affiliate's phone — store phone in Affiliate model
    logger.info(`[Notify] Payout approved notification for ${affiliate.userName}: ${amount} DH`);
  },

  /* Low stock alert to admin */
  async lowStockAlert(product) {
    if (!ADMIN_WA) return;
    const msg = `⚠️ *Stock faible — E-Shopia*\n\n📦 ${product.name}\nStock restant: *${product.stock} unités*\nID: ${product._id}`;
    await sendWhatsApp(ADMIN_WA, msg);
  },

};

module.exports = notifyService;
