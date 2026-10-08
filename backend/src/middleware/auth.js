const jwt = require('jsonwebtoken');

const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

// A login token lasts for days, so on its own it would keep working after the
// owner suspends a restaurant or driver. This checks, on every request, that
// the account behind the token is still approved. `table` is only ever one of
// the two literals passed below.
async function stillApproved(table, id, res, next) {
  try {
    const { rows } = await pool.query(`SELECT approved FROM ${table} WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(401).json({ error: 'This account no longer exists' });
    if (!rows[0].approved) {
      return res.status(403).json({ error: 'This account has been suspended. Please contact MidFood.' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role) {
      return res.status(403).json({ error: 'This login is not a customer account' });
    }
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Same JWT mechanism as requireAuth, but for restaurant-portal logins
// (see routes/restaurantAuth.js). Tokens are tagged { role: 'restaurant' }
// so a customer's token can never be used to access another restaurant's
// portal, and vice versa.
function requireRestaurantAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'restaurant') {
      return res.status(403).json({ error: 'This login is not a restaurant account' });
    }
    req.restaurantId = payload.sub;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  return stillApproved('restaurants', req.restaurantId, res, next);
}

// Driver app logins (see routes/driverAuth.js), tagged { role: 'driver' }.
function requireDriverAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'driver') {
      return res.status(403).json({ error: 'This login is not a driver account' });
    }
    req.driverId = payload.sub;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  return stillApproved('drivers', req.driverId, res, next);
}

// Protects the admin endpoints used to create/manage restaurant portal
// accounts. There's only one admin (the platform owner), so instead of a
// full user/role system this is a single shared secret set via the
// ADMIN_KEY env var (see render.yaml) and sent as the `x-admin-key` header.
function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_KEY;
  if (!configuredKey) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured on the server' });
  }

  const providedKey = req.headers['x-admin-key'];
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  next();
}

module.exports = { requireAuth, requireRestaurantAuth, requireDriverAuth, requireAdmin, JWT_SECRET };
