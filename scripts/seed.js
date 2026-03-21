'use strict';
/* ============================================================
   E-SHOPIA MAROC — Database Seed Script
   Run: node scripts/seed.js
   ============================================================ */

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── Connect ────────────────────────────────────────────────
async function connect() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eshopia';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
}

// ── Schemas (inline for seed script independence) ───────────
const User    = require('../src/models/User');
const Product = require('../src/models/Product');

// ── Seed products matching frontend PRODUCTS array ──────────
const PRODUCTS = [
  { name: 'AirBuds Pro 3 — Réduction Bruit Active',    name_en: 'AirBuds Pro 3 — Active Noise Cancellation', name_ar: 'إير بودز برو 3 — إلغاء الضوضاء النشط',    cat: 'Électronique',          price: 349, oldPrice: 549,  img: '🎧', badge: 'top',  stock: 45,  sold: 214, rating: 4.8, reviewCount: 214, desc: 'Réduction de bruit active 40dB, 30h autonomie, son Hi-Fi premium.' },
  { name: 'SmartWatch Fitness Elite GPS',               name_en: 'SmartWatch Fitness Elite GPS',              name_ar: 'ساعة ذكية فيتنس إليت GPS',               cat: 'Électronique',          price: 799, oldPrice: 1199, img: '⌚', badge: 'top',  stock: 28,  sold: 187, rating: 4.7, reviewCount: 187, desc: 'GPS intégré, suivi cardiaque continu, résistant 50m, 7 jours autonomie.' },
  { name: 'PowerBank Ultra Slim 20000mAh 65W',          name_en: 'PowerBank Ultra Slim 20000mAh 65W',         name_ar: 'باور بنك سليم 20000 مللي أمبير 65 واط',  cat: 'Accessoires Téléphone', price: 189, oldPrice: 299,  img: '🔋', badge: '',    stock: 120, sold: 432, rating: 4.6, reviewCount: 432, desc: 'Charge rapide 65W Power Delivery, design ultra-slim.' },
  { name: 'Robot Aspirateur Laser 4000Pa Auto-Vide',    name_en: 'Robot Vacuum Laser 4000Pa Auto-Empty',      name_ar: 'روبوت مكنسة ليزر 4000 باسكال',            cat: 'Maison & Cuisine',      price: 1299,oldPrice: 1899, img: '🤖', badge: 'top',  stock: 15,  sold: 98,  rating: 4.9, reviewCount: 98,  desc: 'Navigation LiDAR précise, aspiration 4000Pa, vidage automatique.' },
  { name: 'Dashcam 4K HDR GPS WiFi Vision Nocturne',    name_en: 'Dashcam 4K HDR GPS WiFi Night Vision',      name_ar: 'كاميرا سيارة 4K مع GPS وواي فاي',         cat: 'Auto & Moto',           price: 599, oldPrice: 899,  img: '📹', badge: '',    stock: 33,  sold: 156, rating: 4.6, reviewCount: 156, desc: 'Enregistrement 4K HDR, vision nocturne, GPS intégré, WiFi.' },
  { name: 'Clavier Mécanique RGB 87T Cherry MX Blue',   name_en: 'Mechanical Keyboard RGB 87 Cherry MX Blue', name_ar: 'لوحة مفاتيح ميكانيكية RGB 87 مفتاح',      cat: 'Électronique',          price: 289, oldPrice: 429,  img: '⌨️',badge: '',    stock: 52,  sold: 176, rating: 4.6, reviewCount: 176, desc: 'Switches Cherry MX Blue authentiques, RGB 16 millions couleurs.' },
  { name: 'Montre Connectée AMOLED Style Fashion',      name_en: 'AMOLED Smart Watch Fashion Style',          name_ar: 'ساعة ذكية AMOLED أنيقة',                 cat: 'Électronique',          price: 449, oldPrice: 699,  img: '⌚', badge: 'new',  stock: 67,  sold: 289, rating: 4.5, reviewCount: 289, desc: 'Écran AMOLED 1.4 pouces always-on, 100+ cadrans, paiement NFC.' },
  { name: 'Chargeur MagSafe 3-en-1 15W Rapide',         name_en: 'MagSafe 3-in-1 15W Fast Charger',          name_ar: 'شاحن ماج سيف 3 في 1 15 واط سريع',        cat: 'Accessoires Téléphone', price: 249, oldPrice: 399,  img: '🔌', badge: '',    stock: 89,  sold: 321, rating: 4.7, reviewCount: 321, desc: 'Charge simultanée iPhone + Watch + AirPods, 15W maximum.' },
  { name: 'Aspirateur Cyclone 350W Sans Fil 70min',     name_en: 'Cyclone Vacuum 350W Cordless 70min',        name_ar: 'مكنسة كهربائية سايكلون 350 واط لاسلكية',  cat: 'Maison & Cuisine',      price: 449, oldPrice: 699,  img: '🌀', badge: '',    stock: 41,  sold: 134, rating: 4.5, reviewCount: 134, desc: '350W haute puissance, 70min autonomie, filtre HEPA H13.' },
  { name: 'GPS Voiture 7 Pouces HD Cartes Maroc',       name_en: 'Car GPS 7 Inch HD Morocco Maps',            name_ar: 'جي بي إس سيارة 7 بوصة خرائط المغرب',     cat: 'Auto & Moto',           price: 329, oldPrice: 499,  img: '🗺️',badge: '',    stock: 88,  sold: 267, rating: 4.4, reviewCount: 267, desc: 'Écran 7 pouces HD tactile, cartes Maroc préinstallées.' },
  { name: 'Écran Portable 15.6" IPS Full HD USB-C',     name_en: 'Portable Monitor 15.6" IPS Full HD USB-C',  name_ar: 'شاشة محمولة 15.6 بوصة IPS Full HD',      cat: 'Informatique & Bureau', price: 899, oldPrice: 1299, img: '🖥️',badge: 'new',  stock: 22,  sold: 43,  rating: 4.8, reviewCount: 43,  desc: 'IPS Full HD 1080p, 300 nits, USB-C & HDMI.' },
  { name: 'Bracelet Fitness SpO2 14 Jours AMOLED',      name_en: 'Fitness Band SpO2 14 Days AMOLED',          name_ar: 'سوار لياقة SpO2 14 يوم AMOLED',           cat: 'Sport & Fitness',       price: 199, oldPrice: 299,  img: '💪', badge: '',    stock: 110, sold: 412, rating: 4.4, reviewCount: 412, desc: 'Mesure SpO2, stress, sommeil, 120 modes sport.' },
  { name: 'Support Téléphone Magnétique 360° Voiture',  name_en: 'Magnetic Phone Holder 360° Car',            name_ar: 'حامل هاتف مغناطيسي 360° للسيارة',         cat: 'Auto & Moto',           price: 89,  oldPrice: 149,  img: '📱', badge: '',    stock: 200, sold: 634, rating: 4.5, reviewCount: 634, desc: 'Fixation magnétique ultra-puissante, rotation 360°.' },
  { name: 'Casque Gaming 7.1 Surround RGB Pro',         name_en: 'Gaming Headset 7.1 Surround RGB Pro',       name_ar: 'سماعة جيمنج 7.1 سراوند RGB احترافية',     cat: 'Gaming',                price: 379, oldPrice: 599,  img: '🎮', badge: 'top',  stock: 37,  sold: 98,  rating: 4.7, reviewCount: 98,  desc: 'Son surround 7.1 virtuel, microphone antibruit amovible.' },
  { name: 'Enceinte Bluetooth 360° IPX7 18h',           name_en: 'Bluetooth Speaker 360° IPX7 18h',           name_ar: 'مكبر بلوتوث 360° مقاوم للماء 18 ساعة',    cat: 'Accessoires Téléphone', price: 199, oldPrice: 299,  img: '🔊', badge: '',    stock: 95,  sold: 543, rating: 4.5, reviewCount: 543, desc: 'Son 360 degrés immersif, IPX7 étanche, 18h autonomie.' },
  { name: 'Lampe LED Bureau Anti-fatigue 5 Modes',      name_en: 'LED Desk Lamp Anti-eye-strain 5 Modes',     name_ar: 'مصباح مكتب LED مضاد لإجهاد العيون',       cat: 'Maison & Cuisine',      price: 159, oldPrice: 239,  img: '💡', badge: 'new',  stock: 78,  sold: 267, rating: 4.4, reviewCount: 267, desc: '5 modes lumière, graduation infinie, port USB-C charge.' },
];

// ── Admin users to seed ──────────────────────────────────────
const ADMIN_USERS = [
  { name: 'Admin E-Shopia', email: 'admin@eshopia.ma',   password: 'Admin@2024!', role: 'superadmin', phone: '0600000001', city: 'Casablanca' },
  { name: 'Agent Sara',     email: 'sara@eshopia.ma',    password: 'Agent@2024!', role: 'agent',      phone: '0600000002', city: 'Casablanca' },
  { name: 'Agent Karim',    email: 'karim@eshopia.ma',   password: 'Agent@2024!', role: 'agent',      phone: '0600000003', city: 'Rabat'       },
  { name: 'Test Client',    email: 'client@eshopia.ma',  password: 'Client@2024!',role: 'client',     phone: '0612345678', city: 'Marrakech'   },
];

// ── Main seed function ───────────────────────────────────────
async function seed() {
  try {
    await connect();

    // ── 1. Clear existing data ────────────────────────────
    console.log('🗑️  Clearing existing data...');
    await Product.deleteMany({});
    await User.deleteMany({});

    // ── 2. Seed products ──────────────────────────────────
    console.log('📦 Seeding products...');
    const products = await Product.insertMany(PRODUCTS.map(p => ({
      ...p,
      isActive: true,
      images: [],
    })));
    console.log(`   ✅ ${products.length} products created`);

    // ── 3. Seed users ─────────────────────────────────────
    console.log('👥 Seeding users...');
    for (const userData of ADMIN_USERS) {
      const hashed = await bcrypt.hash(userData.password, 12);
      await User.create({ ...userData, password: hashed });
      console.log(`   ✅ ${userData.role}: ${userData.email} (pwd: ${userData.password})`);
    }

    // ── 4. Summary ────────────────────────────────────────
    console.log('\n' + '═'.repeat(50));
    console.log('🎉 SEED COMPLETE');
    console.log('═'.repeat(50));
    console.log(`📦 Products: ${products.length}`);
    console.log(`👥 Users:    ${ADMIN_USERS.length}`);
    console.log('\n📋 Login credentials:');
    ADMIN_USERS.forEach(u => console.log(`   ${u.role.padEnd(12)} ${u.email} / ${u.password}`));
    console.log('═'.repeat(50));

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
