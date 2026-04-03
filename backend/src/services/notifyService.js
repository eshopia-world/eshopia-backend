'use strict';
const axios  = require('axios');
const logger = require('../utils/logger');

/* ══════════════════════════════════════════════
   NOTIFY SERVICE — WhatsApp Business + SMS
   ══════════════════════════════════════════════ */

const WA_TOKEN    = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_API      = `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`;
const ADMIN_WA    = process.env.ADMIN_WHATSAPP;

/* ── Send WhatsApp text message ── */
async function sendWhatsApp(to, message) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    logger.debug(`[Notify] WA not configured — would send to ${to}: ${message.slice(0,60)}...`);
    return;
  }
  const phone = to.replace(/[^0-9]/g, '');
  try {
    await axios.post(WA_API, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message },
    }, {
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    });
    logger.info(`[Notify] WA sent to ${phone}`);
  } catch (err) {
    logger.warn(`[Notify] WA failed to ${phone}: ${err.response?.data?.error?.message || err.message}`);
  }
}

/* ── Notify admin of new order ── */
async function newOrderAdmin(order) {
  if (!ADMIN_WA) return;
  const items = order.items.map(i => `• ${i.productName} x${i.qty}`).join('\n');
  const msg = `🛒 *Nouvelle commande E-Shopia*\n\n` +
    `📋 *${order.orderNumber}*\n` +
    `👤 ${order.client?.name}\n` +
    `📞 ${order.client?.phone}\n` +
    `📍 ${order.client?.city}\n` +
    `💰 *${order.total} DH* (COD)\n\n` +
    `${items}\n\n` +
    `⚡ Confirmez rapidement !`;
  await sendWhatsApp(ADMIN_WA, msg);
}

/* ── Notify client of order status change ── */
async function orderStatusUpdated(order) {
  const phone = order.client?.phone;
  if (!phone) return;

  const msgs = {
    confirmed: `✅ *Commande confirmée !*\n\nBonjour ${order.client?.name},\n\nVotre commande *${order.orderNumber}* a été confirmée.\n\n🚚 Livraison sous 24-48h à ${order.client?.city}.\n💵 Paiement en cash à la livraison.\n\nMerci de votre confiance — E-Shopia Maroc 🇲🇦`,
    shipped:   `📦 *Commande expédiée !*\n\nBonjour ${order.client?.name},\n\nVotre commande *${order.orderNumber}* est en route !\n\n🚚 Livraison prévue aujourd'hui ou demain.\n${order.trackingCode ? `📍 Code suivi: ${order.trackingCode}` : ''}\n\nE-Shopia Maroc`,
    delivered: `🎉 *Commande livrée !*\n\nBonjour ${order.client?.name},\n\nVotre commande *${order.orderNumber}* a été livrée.\n\n⭐ Vous êtes satisfait ? Laissez-nous un avis !\n💬 Contact: wa.me/212702010303\n\nMerci — E-Shopia Maroc 🛍️`,
    refused:   `❌ *Commande annulée*\n\nBonjour ${order.client?.name},\n\nVotre commande *${order.orderNumber}* a été annulée.\n\nPour toute question: wa.me/212702010303\n\nE-Shopia Maroc`,
  };

  const msg = msgs[order.status];
  if (msg) await sendWhatsApp(phone, msg);
}

/* ── Abandoned cart recovery ── */
async function abandonedCartReminder(phone, name, items) {
  const msg = `🛒 *Vous avez oublié quelque chose !*\n\nBonjour ${name},\n\nVous avez laissé des articles dans votre panier :\n${items}\n\n🎁 Commandez maintenant et profitez de la livraison rapide !\n\n👉 eshopia.netlify.app\n\nE-Shopia Maroc 🇲🇦`;
  await sendWhatsApp(phone, msg);
}

/* ── Low stock alert to admin ── */
async function lowStockAlert(products) {
  if (!ADMIN_WA || !products.length) return;
  const list = products.map(p => `• ${p.name}: *${p.stock} restants*`).join('\n');
  const msg = `⚠️ *Alerte Stock Faible — E-Shopia*\n\n${list}\n\nMettez à jour votre stock rapidement !`;
  await sendWhatsApp(ADMIN_WA, msg);
}

/* ── orderPlaced = alias for newOrderAdmin ── */
const orderPlaced = newOrderAdmin;

module.exports = { sendWhatsApp, newOrderAdmin, orderPlaced, orderStatusUpdated, abandonedCartReminder, lowStockAlert };
