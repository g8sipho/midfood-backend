const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
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
      `SELECT id, name, username, password_hash AS "passwordHash"
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

    const token = jwt.sign({ sub: restaurant.id, role: 'restaurant' }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    res.json({ token, restaurant: { id: restaurant.id, name: restaurant.name, username: restaurant.username } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
