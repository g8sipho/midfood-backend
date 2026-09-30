require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const db = require('./db');
const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const orderRoutes = require('./routes/orders');
const restaurantAuthRoutes = require('./routes/restaurantAuth');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const driverAuthRoutes = require('./routes/driverAuth');
const driverRoutes = require('./routes/driver');

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and most hosts) terminate HTTPS at a proxy in front of this app,
// forwarding requests over plain HTTP with an X-Forwarded-Proto header.
// Trusting that header is what lets req.protocol correctly report "https"
// here -- needed so the PayFast return/cancel/notify URLs built in
// routes/orders.js come out as real https:// links instead of http://.
app.set('trust proxy', true);

// The mobile app has no browser origin, and the portal/driver pages are served
// from this same host, so CORS can stay closed to other websites. Set
// ALLOWED_ORIGINS (comma-separated) if a separate web front-end is ever added.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  })
);

// Basic security headers. No CDNs or third-party scripts are used, so the
// pages can be locked to same-origin assets.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'"
  );
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));

// Restaurant portal (menu management) and the admin page used to create
// restaurant accounts -- static HTML/JS, served straight from this same
// service so there's nothing extra to host or pay for.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'midfood-backend' }));

// Simple in-memory rate limit on the login/sign-up endpoints, so a stolen
// username can't be brute-forced. One process per Render instance, which is
// enough at this scale; swap for a shared store if the API is ever scaled out.
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function rateLimitAuth(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 });
    return next();
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  next();
}

// Keep the map from growing without bound on a long-running instance.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    if (now - rec.start > WINDOW_MS) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

app.use(['/api/auth/login', '/api/auth/register'], rateLimitAuth);
app.use(['/api/restaurant-auth', '/api/driver-auth'], rateLimitAuth);

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/restaurant-auth', restaurantAuthRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/driver-auth', driverAuthRoutes);
app.use('/api/driver', driverRoutes);

// Fallback 404 for anything unmatched under /api
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Run migrations + seed data before accepting traffic, so a fresh Postgres
// (a brand-new Render/Railway/Fly database, or a first `docker compose up`
// locally) is ready on the very first request instead of erroring.
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MidFood backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize the database:', err);
    process.exit(1);
  });
