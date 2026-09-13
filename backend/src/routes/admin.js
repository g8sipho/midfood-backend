// Admin-only endpoints for onboarding restaurants (Option A: the platform
// owner creates every restaurant account by hand -- there is no public
// restaurant sign-up page). Protected by a single shared secret, ADMIN_KEY
// (see middleware/auth.js and render.yaml), sent as the `x-admin-key` header.
// This is intentionally simple: one admin, one key, no separate admin-user
// system -- revisit if MidFood ever needs more than one person managing this.
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, uuid } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

// GET /api/admin/restaurants - list every restaurant and whether it has a
// portal login yet (never returns the password hash itself)
router.get('/restaurants', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, cuisine, eta_minutes AS "etaMinutes", delivery_fee::float8 AS "deliveryFee",
              rating::float8 AS rating, hero_color AS "heroColor", username,
              (password_hash IS NOT NULL) AS "hasAccount"
       FROM restaurants ORDER BY name`
    );
    res.json({ restaurants: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/restaurants - create a brand-new restaurant + its portal login
router.post('/restaurants', async (req, res, next) => {
  try {
    const { name, cuisine, etaMinutes, deliveryFee, heroColor, username, password } = req.body || {};
    if (!name || !cuisine || !etaMinutes || deliveryFee == null || !heroColor || !username || !password) {
      return res.status(400).json({
        error: 'name, cuisine, etaMinutes, deliveryFee, heroColor, username and password are all required',
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const normalizedUsername = normalizeUsername(username);
    const existing = await pool.query('SELECT id FROM restaurants WHERE username = $1', [normalizedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuid();
    // New restaurants start at a neutral rating; there's no review system yet.
    await pool.query(
      `INSERT INTO restaurants (id, name, cuisine, eta_minutes, delivery_fee, rating, hero_color, username, password_hash)
       VALUES ($1, $2, $3, $4, $5, 4.5, $6, $7, $8)`,
      [id, name, cuisine, etaMinutes, deliveryFee, heroColor, normalizedUsername, passwordHash]
    );
    res.status(201).json({ restaurant: { id, name, username: normalizedUsername } });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/restaurants/:id/set-account - give an existing restaurant a
// portal login (or reset one), without touching its menu/listing details
router.post('/restaurants/:id/set-account', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const normalizedUsername = normalizeUsername(username);
    const existing = await pool.query('SELECT id FROM restaurants WHERE username = $1 AND id <> $2', [
      normalizedUsername,
      req.params.id,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `UPDATE restaurants SET username = $1, password_hash = $2 WHERE id = $3
       RETURNING id, name, username`,
      [normalizedUsername, passwordHash, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
