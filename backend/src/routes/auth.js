const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, uuid } = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { normalizePhone, looksLikePhone } = require('../phone');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone || null, createdAt: user.createdAt };
}

// POST /api/auth/register { name, email, password, phone? }
// The cellphone number is optional here (older app versions don't send it)
// but once set it can be used to log in, and the driver uses it at the door.
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    let normalizedPhone = null;
    if (phone != null && String(phone).trim() !== '') {
      normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit cellphone number, e.g. 082 123 4567' });
      }
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    if (normalizedPhone) {
      const taken = await pool.query('SELECT id FROM users WHERE phone = $1', [normalizedPhone]);
      if (taken.rows.length > 0) {
        return res.status(409).json({ error: 'An account with that cellphone number already exists. Log in with it instead.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuid();
    const createdAt = new Date().toISOString();

    await pool.query(
      'INSERT INTO users (id, name, email, phone, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, name, normalizedEmail, normalizedPhone, passwordHash, createdAt]
    );

    const token = jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(201).json({ token, user: publicUser({ id, name, email: normalizedEmail, phone: normalizedPhone, createdAt }) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login { identifier, password } - identifier is the email
// address or the cellphone number. `email` is still accepted for older apps.
router.post('/login', async (req, res, next) => {
  try {
    const { identifier, email, password } = req.body || {};
    const who = String(identifier || email || '').trim();
    if (!who || !password) {
      return res.status(400).json({ error: 'email or cellphone number, and password, are required' });
    }

    const byPhone = looksLikePhone(who) ? normalizePhone(who) : null;
    const byEmail = who.toLowerCase();
    // Several accounts may share a phone number from before numbers were
    // checked at sign-up, so every match is tried against the password.
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, password_hash AS "passwordHash", created_at AS "createdAt"
       FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND phone = $2)
       ORDER BY created_at`,
      [byEmail, byPhone]
    );
    let user = null;
    for (const candidate of rows) {
      if (await bcrypt.compare(password, candidate.passwordHash)) { user = candidate; break; }
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email, cellphone number or password' });
    }

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - restores a saved session when the app reopens, so
// customers aren't asked to log in again every time.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, phone, created_at AS "createdAt" FROM users WHERE id = $1',
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/push-token - the app registers its Expo push token so the
// customer gets notified as their order moves along.
router.put('/push-token', requireAuth, async (req, res, next) => {
  try {
    const { token, phone } = req.body || {};
    await pool.query(
      'UPDATE users SET push_token = COALESCE($1, push_token), phone = COALESCE($2, phone) WHERE id = $3',
      [token || null, normalizePhone(phone), req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
