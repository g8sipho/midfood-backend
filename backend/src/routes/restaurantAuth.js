const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, uuid } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Login for restaurant owners (the portal at /portal). Accounts are created
// by the platform admin via /api/admin/restaurants — there is no public
// restaurant sign-up.
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, name, username, approved, password_hash AS "passwordHash"
       FROM restaurants WHERE username = $1`,
      [normalizedUsername]
    );
    const restaurant = rows[0];
    if (!restaurant || !restaurant.passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, restaurant.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!restaurant.approved) {
      return res.status(403).json({ error: 'Your restaurant is still waiting for approval by MidFood. We will contact you soon.' });
    }

    const token = jwt.sign({ sub: restaurant.id, role: 'restaurant' }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    res.json({ token, restaurant: { id: restaurant.id, name: restaurant.name, username: restaurant.username } });
  } catch (err) {
    next(err);
  }
});

// POST /api/restaurant-auth/register - self-service restaurant sign-up.
// Creates the restaurant as NOT approved: it stays hidden from customers and
// can't log in until the platform admin approves it (see routes/admin.js).
router.post('/register', async (req, res, next) => {
  try {
    const { name, cuisine, phone, address, username, password, deliveryFee, etaMinutes } = req.body || {};
    if (!name || !cuisine || !phone || !address || !username || !password) {
      return res.status(400).json({ error: 'name, cuisine, phone, address, username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const normalizedUsername = String(username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'username must be 3-30 letters, numbers, dots, dashes or underscores' });
    }
    const existing = await pool.query('SELECT id FROM restaurants WHERE username = $1', [normalizedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    const colors = ['#d97757', '#558a42', '#2a78d6', '#c9a82d', '#8b6ac8', '#a63244'];
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO restaurants (id, name, cuisine, eta_minutes, delivery_fee, rating, hero_color, username, password_hash, approved, phone, address)
       VALUES ($1, $2, $3, $4, $5, 4.5, $6, $7, $8, false, $9, $10)`,
      [
        uuid(), name, cuisine,
        Number(etaMinutes) > 0 ? Number(etaMinutes) : 35,
        Number(deliveryFee) >= 0 ? Number(deliveryFee) : 25,
        colors[Math.floor(Math.random() * colors.length)],
        normalizedUsername, passwordHash, phone, address,
      ]
    );
    res.status(201).json({ ok: true, message: 'Thanks! MidFood will review your restaurant and contact you once it is approved.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
