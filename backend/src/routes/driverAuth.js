const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, uuid } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

// POST /api/driver-auth/register - drivers apply; the admin approves them.
router.post('/register', async (req, res, next) => {
  try {
    const { name, phone, username, password } = req.body || {};
    if (!name || !phone || !username || !password) {
      return res.status(400).json({ error: 'name, phone, username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const u = String(username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
      return res.status(400).json({ error: 'username must be 3-30 letters, numbers, dots, dashes or underscores' });
    }
    const existing = await pool.query('SELECT id FROM drivers WHERE username = $1', [u]);
    if (existing.rows.length) return res.status(409).json({ error: 'That username is already taken' });
    await pool.query(
      'INSERT INTO drivers (id, name, phone, username, password_hash, approved) VALUES ($1,$2,$3,$4,$5,false)',
      [uuid(), name, phone, u, await bcrypt.hash(password, 10)]
    );
    res.status(201).json({ ok: true, message: 'Thanks! MidFood will review your application and contact you.' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    const { rows } = await pool.query(
      'SELECT id, name, phone, approved, password_hash AS "passwordHash" FROM drivers WHERE username = $1',
      [String(username).trim().toLowerCase()]
    );
    const d = rows[0];
    if (!d || !(await bcrypt.compare(password, d.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (!d.approved) {
      return res.status(403).json({ error: 'Your driver account is still waiting for approval by MidFood.' });
    }
    const token = jwt.sign({ sub: d.id, role: 'driver' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, driver: { id: d.id, name: d.name, phone: d.phone } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
