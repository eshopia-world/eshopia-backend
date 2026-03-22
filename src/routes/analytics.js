'use strict';
const express   = require('express');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const User      = require('../models/User');
const Affiliate = require('../models/Affiliate');
const { asyncHandler, protect, restrictTo } = require('../middleware/auth');
const router    = express.Router();

/* GET /api/analytics/overview */
router.get('/overview', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const today     = new Date(); today.setHours(0,0,0,0);
  const monthStart= new Date(today.getFullYear(), today.getMonth(), 1);
  const last14    = new Date(Date.now() - 14*86400000);

  const [todayOrders, monthOrders, allDelivered, allRefused, allTotal,
         topProducts, topCities, revenueByDay, affStats] = await Promise.all([
    // Today
    Order.aggregate([
      { $match:{ createdAt:{ $gte:today } } },
      { $group:{ _id:null, orders:{ $sum:1 }, revenue:{ $sum:'$total' } } }
    ]),
    // Month
    Order.aggregate([
      { $match:{ createdAt:{ $gte:monthStart } } },
      { $group:{ _id:null, orders:{ $sum:1 }, revenue:{ $sum:'$total' } } }
    ]),
    Order.countDocuments({ status:'delivered' }),
    Order.countDocuments({ status:'refused' }),
    Order.countDocuments(),
    // Top products
    Order.aggregate([
      { $match:{ status:'delivered' } },
      { $unwind:'$items' },
      { $group:{ _id:'$items.productId', name:{ $first:'$items.productName' }, unitsSold:{ $sum:'$items.qty' }, revenue:{ $sum:{ $multiply:['$items.qty','$items.price'] } } } },
      { $sort:{ unitsSold:-1 } }, { $limit:10 }
    ]),
    // Top cities
    Order.aggregate([
      { $match:{ status:'delivered' } },
      { $group:{ _id:'$client.city', count:{ $sum:1 }, revenue:{ $sum:'$total' } } },
      { $sort:{ count:-1 } }, { $limit:8 }
    ]),
    // Revenue by day (last 14)
    Order.aggregate([
      { $match:{ createdAt:{ $gte:last14 }, status:{ $in:['delivered','confirmed','shipped'] } } },
      { $group:{ _id:{ $dateToString:{ format:'%Y-%m-%d', date:'$createdAt' } }, orders:{ $sum:1 }, revenue:{ $sum:'$total' } } },
      { $sort:{ _id:1 } }
    ]),
    // Affiliate summary
    Affiliate.aggregate([
      { $group:{ _id:null, total:{ $sum:1 }, clicks:{ $sum:'$totalClicks' }, orders:{ $sum:'$totalOrders' }, commissions:{ $sum:'$totalEarned' } } }
    ]),
  ]);

  const deliveryRate = allTotal > 0 ? Math.round(allDelivered/allTotal*100) : 0;
  const refusalRate  = allTotal > 0 ? Math.round(allRefused/allTotal*100)   : 0;

  res.json({
    status: 'success',
    overview: {
      today:   { orders: todayOrders[0]?.orders||0, revenue: todayOrders[0]?.revenue||0 },
      month:   { orders: monthOrders[0]?.orders||0, revenue: monthOrders[0]?.revenue||0 },
      allTime: { orders: allTotal, delivered: allDelivered, refused: allRefused, deliveryRate, refusalRate },
    },
    topProducts,
    topCities,
    revenueByDay,
    affiliates: affStats[0] || { total:0, clicks:0, orders:0, commissions:0 },
  });
}));

/* GET /api/analytics/client-scores */
router.get('/client-scores', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const [high, med, low] = await Promise.all([
    User.countDocuments({ role:'client', 'clientScore.total':{ $gte:70 } }),
    User.countDocuments({ role:'client', 'clientScore.total':{ $gte:40, $lt:70 } }),
    User.countDocuments({ role:'client', 'clientScore.total':{ $lt:40 } }),
  ]);
  res.json({ status:'success', scores:{ high, med, low } });
}));

/* GET /api/analytics/products */
router.get('/products', protect, restrictTo('admin','superadmin'), asyncHandler(async (req, res) => {
  const products = await Product.find({ isActive:true }).sort('-sold').limit(20).select('name img cat price sold views rating stock').lean();
  res.json({ status:'success', products });
}));

module.exports = router;
