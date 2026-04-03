'use strict';
require('dotenv').config();
const express       = require('express');
const mongoose      = require('mongoose');
const cors          = require('cors');
const helmet        = require('helmet');
const compression   = require('compression');
const morgan        = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit     = require('express-rate-limit');

const app = express();

/* ── Security ─────────────────────────────────── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    /https:\/\/.*\.netlify\.app$/,
    /https:\/\/.*\.eshopia\.ma$/,
    'https://eshopia.ma',
    'https://www.eshopia.ma',
  ].filter(Boolean),
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(morgan('dev'));

/* ── Global rate limit ────────────────────────── */
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { status: 'fail', message: 'Too many requests' },
}));

/* ── Health check ─────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ── Routes ───────────────────────────────────── */
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/orders',      require('./routes/orders'));
app.use('/api/products',    require('./routes/products'));
app.use('/api/affiliate',   require('./routes/affiliate'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/agents',      require('./routes/agents'));
app.use('/api/tracking',    require('./routes/tracking'));
app.use('/api/analytics',   require('./routes/analytics'));
app.use('/api/delivery',    require('./routes/delivery'));

/* ── 404 ──────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ status: 'fail', message: 'Route not found' }));

/* ── Error handler ────────────────────────────── */
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    status: status < 500 ? 'fail' : 'error',
    message: err.message || 'Internal server error',
  });
});

/* ── Connect DB & Start ───────────────────────── */
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
}).then(() => {
  console.log('✅ MongoDB connected');
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 E-Shopia API on port ${PORT}`));

  // Scheduled jobs
  require('./services/scheduler').scheduledJobs();

}).catch(err => {
  console.error('❌ MongoDB failed:', err.message);
  process.exit(1);
});

module.exports = app;
