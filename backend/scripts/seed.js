'use strict';
// Support running from project root OR scripts/ folder
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config(); // fallback
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../src/models/User');
const Product  = require('../src/models/Product');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eshopia';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Clear existing
  await Product.deleteMany({});
  await User.deleteMany({});

  // ── Products ──
  const products = await Product.insertMany([
    { name:'AirBuds Pro 3 — Réduction Bruit Active',    name_ar:'إيربودز برو 3', cat:'Électronique',          price:349, oldPrice:549,  img:'🎧', badge:'top',  stock:45,  sold:214, rating:4.8, reviewCount:214 },
    { name:'SmartWatch Fitness Elite GPS',               name_ar:'ساعة ذكية GPS', cat:'Électronique',          price:799, oldPrice:1199, img:'⌚', badge:'top',  stock:28,  sold:187, rating:4.7, reviewCount:187 },
    { name:'PowerBank Ultra Slim 20000mAh 65W',          name_ar:'باور بنك 65W',  cat:'Accessoires Téléphone', price:189, oldPrice:299,  img:'🔋', badge:'',     stock:120, sold:432, rating:4.6, reviewCount:432 },
    { name:'Robot Aspirateur Laser 4000Pa Auto-Vide',    name_ar:'روبوت مكنسة',   cat:'Maison & Cuisine',      price:1299,oldPrice:1899, img:'🤖', badge:'top',  stock:15,  sold:98,  rating:4.9, reviewCount:98  },
    { name:'Dashcam 4K HDR GPS WiFi Vision Nocturne',    name_ar:'كاميرا سيارة',  cat:'Auto & Moto',           price:599, oldPrice:899,  img:'📹', badge:'',     stock:33,  sold:156, rating:4.6, reviewCount:156 },
    { name:'Clavier Mécanique RGB 87T Cherry MX Blue',   name_ar:'كيبورد ميكانيكي',cat:'Électronique',         price:289, oldPrice:429,  img:'⌨️',badge:'',     stock:52,  sold:176, rating:4.6, reviewCount:176 },
    { name:'Montre Connectée AMOLED Style Fashion',       name_ar:'ساعة AMOLED',   cat:'Électronique',          price:449, oldPrice:699,  img:'⌚', badge:'new',  stock:67,  sold:289, rating:4.5, reviewCount:289 },
    { name:'Chargeur MagSafe 3-en-1 15W Rapide',          name_ar:'شاحن 3 في 1',   cat:'Accessoires Téléphone', price:249, oldPrice:399,  img:'🔌', badge:'',     stock:89,  sold:321, rating:4.7, reviewCount:321 },
    { name:'Aspirateur Cyclone 350W Sans Fil 70min',      name_ar:'مكنسة سايكلون', cat:'Maison & Cuisine',      price:449, oldPrice:699,  img:'🌀', badge:'',     stock:41,  sold:134, rating:4.5, reviewCount:134 },
    { name:'GPS Voiture 7 Pouces HD Cartes Maroc',        name_ar:'GPS 7 بوصة',    cat:'Auto & Moto',           price:329, oldPrice:499,  img:'🗺️',badge:'',     stock:88,  sold:267, rating:4.4, reviewCount:267 },
    { name:'Écran Portable 15.6" IPS Full HD USB-C',     name_ar:'شاشة محمولة',   cat:'Informatique & Bureau', price:899, oldPrice:1299, img:'🖥️',badge:'new',  stock:22,  sold:43,  rating:4.8, reviewCount:43  },
    { name:'Bracelet Fitness SpO2 14 Jours AMOLED',       name_ar:'سوار لياقة',    cat:'Sport & Fitness',       price:199, oldPrice:299,  img:'💪', badge:'',     stock:110, sold:412, rating:4.4, reviewCount:412 },
    { name:'Support Téléphone Magnétique 360° Voiture',   name_ar:'حامل هاتف',     cat:'Auto & Moto',           price:89,  oldPrice:149,  img:'📱', badge:'',     stock:200, sold:634, rating:4.5, reviewCount:634 },
    { name:'Casque Gaming 7.1 Surround RGB Pro',          name_ar:'سماعة جيمنج',   cat:'Gaming',                price:379, oldPrice:599,  img:'🎮', badge:'top',  stock:37,  sold:98,  rating:4.7, reviewCount:98  },
    { name:'Enceinte Bluetooth 360° IPX7 18h',            name_ar:'مكبر بلوتوث',   cat:'Accessoires Téléphone', price:199, oldPrice:299,  img:'🔊', badge:'',     stock:95,  sold:543, rating:4.5, reviewCount:543 },
    { name:'Lampe LED Bureau Anti-fatigue 5 Modes',       name_ar:'مصباح LED',     cat:'Maison & Cuisine',      price:159, oldPrice:239,  img:'💡', badge:'new',  stock:78,  sold:267, rating:4.4, reviewCount:267 },
  ].map(p => ({ ...p, isActive: true, desc: `Qualité premium. Livraison 24-48h au Maroc. Paiement à la livraison.` })));

  console.log(`📦 ${products.length} products created`);

  // ── Users ──
  const users = [
    { name:'Admin E-Shopia', email:'admin@eshopia.ma',   password:'Admin@2024!',  role:'superadmin', phone:'0600000001' },
    { name:'Agent Sara',     email:'sara@eshopia.ma',    password:'Agent@2024!',  role:'agent',      phone:'0600000002' },
    { name:'Agent Karim',    email:'karim@eshopia.ma',   password:'Agent@2024!',  role:'agent',      phone:'0600000003' },
    { name:'Test Client',    email:'client@eshopia.ma',  password:'Client@2024!', role:'client',     phone:'0612345678' },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 12);
    await User.create({ ...u, password: hashed });
    console.log(`   ✅ ${u.role}: ${u.email} / ${u.password}`);
  }

  console.log('\n🎉 SEED COMPLETE');
  console.log('═'.repeat(40));
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
