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
const payoutRoutes = require('./routes/payouts');

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
// pages can be locked to same-origin assets. The one outside source is the
// map on the order-tracking page: its code is served from here
// (public/vendor/leaflet), but the map pictures themselves come from
// OpenStreetMap's tile server, so that host is allowed for images only.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'"
  );
  next();
});

app.use(express.json({ limit: '100kb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Restaurant portal (menu management) and the admin page used to create
// restaurant accounts -- static HTML/JS, served straight from this same
// service so there's nothing extra to host or pay for.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'midfood-backend' }));

// Brute-force protection on the auth endpoints.
//
// Deliberately NOT a plain per-IP cap: South African mobile networks put very
// large numbers of customers behind a single carrier-grade NAT address, so a
// tight per-IP limit locks out real people who have done nothing wrong. What
// actually needs protecting is one account against repeated guesses, so the
// limit that bites is per account identifier and counts only FAILED attempts.
// A loose per-IP ceiling stays as a backstop against a crude flood.

const failures = new Map();   // identifier -> { start, count }
const ipHits = new Map();     // ip -> { start, count }

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;      // per account, per 15 minutes
const IP_WINDOW_MS = 10 * 60 * 1000;
const MAX_IP_HITS = 300;      // per IP, per 10 minutes — a flood, not a user

function bump(map, key, windowMs) {
  const now = Date.now();
  const rec = map.get(key);
  if (!rec || now - rec.start > windowMs) {
    map.set(key, { start: now, count: 1 });
    return 1;
  }
  rec.count += 1;
  return rec.count;
}

function countOf(map, key, windowMs) {
  const rec = map.get(key);
  if (!rec || Date.now() - rec.start > windowMs) return 0;
  return rec.count;
}

function rateLimitAuth(req, res, next) {
  const ip = req.ip || 'unknown';
  if (bump(ipHits, ip, IP_WINDOW_MS) > MAX_IP_HITS) {
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  // The account being tried: email for customers, username for the others.
  const body = req.body || {};
  const who = String(body.email || body.username || '').trim().toLowerCase();
  if (who && countOf(failures, who, FAIL_WINDOW_MS) >= MAX_FAILURES) {
    return res.status(429).json({
      error: 'Too many failed attempts for this account. Please wait 15 minutes, or reset your password.',
    });
  }

  // Count the attempt as a failure only once we see the response go out as a
  // 401. A correct password clears the count, so a customer who fat-fingers
  // their password a few times is not punished after they get it right.
  if (who) {
    res.on('finish', () => {
      if (res.statusCode === 401) bump(failures, who, FAIL_WINDOW_MS);
      else if (res.statusCode < 400) failures.delete(who);
    });
  }
  next();
}

// Keep both maps from growing without bound on a long-running instance.
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of failures) if (now - rec.start > FAIL_WINDOW_MS) failures.delete(k);
  for (const [k, rec] of ipHits) if (now - rec.start > IP_WINDOW_MS) ipHits.delete(k);
}, 5 * 60 * 1000).unref();

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
app.use('/api/payouts', payoutRoutes);

// Fallback 404 for anything unmatched under /api
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Run migrations + seed data before accepting traffic, so a fresh Postgres
// (a brand-new Render/Railway/Fly database, or a first `docker compose up`
// locally) is ready on the very first request instead of erroring.
const ready = db
  .init()
  .then(
    () =>
      new Promise((resolve) => {
        const server = app.listen(PORT, () => {
          console.log(`MidFood backend listening on http://localhost:${PORT}`);
          resolve(server);
        });
      })
  )
  .catch((err) => {
    console.error('Failed to initialize the database:', err);
    process.exit(1);
  });

// `ready` resolves with the listening server. The test suite (see test/)
// waits on it, and closes the server when it is done.
module.exports = { app, ready };
