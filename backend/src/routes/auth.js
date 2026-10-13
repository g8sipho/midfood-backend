const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, uuid } = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { normalizePhone, looksLikePhone } = require('../phone');
const mailer = require('../mailer');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '072 643 7784';

// Password-reset codes: six digits, good for 15 minutes, five guesses.
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_MS = 60 * 1000;

// Finds the account behind an email address or a cellphone number.
async function findByIdentifier(who) {
  const byPhone = looksLikePhone(who) ? normalizePhone(who) : null;
  const byEmail = String(who).trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, password_hash AS "passwordHash", created_at AS "createdAt",
            reset_code_hash AS "resetCodeHash", reset_expires_at AS "resetExpiresAt",
            reset_attempts AS "resetAttempts", reset_sent_at AS "resetSentAt"
     FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND phone = $2)
     ORDER BY created_at`,
    [byEmail, byPhone]
  );
  return rows;
}

// "t***i@gmail.com": enough for the customer to recognise the address the
// code went to, not enough for anyone else to learn it.
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '';
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(2, local.length - 2))}${tail}@${domain}`;
}

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

// POST /api/auth/forgot { identifier } - emails a six-digit code to the
// address on the account. The reply is the same whether or not the account
// exists, so the form cannot be used to find out who has signed up.
router.post('/forgot', async (req, res, next) => {
  try {
    const who = String((req.body || {}).identifier || (req.body || {}).email || '').trim();
    if (!who) {
      return res.status(400).json({ error: 'Enter the email address or cellphone number on your account' });
    }
    if (!mailer.isConfigured() && process.env.NODE_ENV !== 'test') {
      return res.status(503).json({
        error: `Password reset by email is not switched on yet. Call or WhatsApp MidFood on ${SUPPORT_PHONE} and we will reset it for you.`,
      });
    }

    const rows = await findByIdentifier(who);
    // Several old accounts may share a phone number; the newest one wins.
    const user = rows[rows.length - 1];
    const generic = {
      ok: true,
      message: 'If that account exists, a 6-digit code has been emailed to its address. It is valid for 15 minutes.',
    };
    if (!user) return res.json(generic);

    // Don't let someone hammer a customer's inbox: one email a minute.
    if (user.resetSentAt && Date.now() - new Date(user.resetSentAt).getTime() < RESET_RESEND_MS) {
      return res.json({ ...generic, emailHint: maskEmail(user.email) });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 8);
    const expires = new Date(Date.now() + RESET_TTL_MS).toISOString();
    await pool.query(
      `UPDATE users SET reset_code_hash = $1, reset_expires_at = $2, reset_attempts = 0, reset_sent_at = NOW()
       WHERE id = $3`,
      [codeHash, expires, user.id]
    );

    const firstName = String(user.name || '').split(' ')[0] || 'there';
    await mailer.send({
      to: user.email,
      subject: `${code} is your MidFood password reset code`,
      text:
        `Hi ${firstName},\n\n` +
        `Your MidFood password reset code is:\n\n    ${code}\n\n` +
        `Type it into the app or website within 15 minutes to choose a new password.\n\n` +
        `If you did not ask for this, you can ignore this email - your password has not changed.\n\n` +
        `MidFood - Middelburg's food, delivered\n${SUPPORT_PHONE}  |  https://midfood.co.za`,
    });

    res.json({ ...generic, emailHint: maskEmail(user.email) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset { identifier, code, password } - checks the emailed
// code, sets the new password and logs the customer straight in.
router.post('/reset', async (req, res, next) => {
  try {
    const { identifier, email, code, password } = req.body || {};
    const who = String(identifier || email || '').trim();
    const typed = String(code || '').replace(/\D/g, '');
    if (!who || !typed || !password) {
      return res.status(400).json({ error: 'The email or cellphone number, the code and a new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const rows = await findByIdentifier(who);
    const candidates = rows.filter((u) => u.resetCodeHash);
    const stale = { error: 'That code is wrong or has expired. Ask for a new one.' };
    if (candidates.length === 0) return res.status(400).json(stale);

    for (const user of candidates) {
      const expired = !user.resetExpiresAt || new Date(user.resetExpiresAt).getTime() < Date.now();
      const burnt = (user.resetAttempts || 0) >= RESET_MAX_ATTEMPTS;
      if (expired || burnt) continue;
      if (await bcrypt.compare(typed, user.resetCodeHash)) {
        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query(
          `UPDATE users SET password_hash = $1, reset_code_hash = NULL, reset_expires_at = NULL, reset_attempts = 0
           WHERE id = $2`,
          [passwordHash, user.id]
        );
        const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ token, user: publicUser(user) });
      }
      await pool.query('UPDATE users SET reset_attempts = reset_attempts + 1 WHERE id = $1', [user.id]);
    }
    res.status(400).json(stale);
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

// PUT /api/auth/password { currentPassword, newPassword } - a signed-in
// customer changes their own password (also how a temporary one handed out
// by MidFood support gets replaced).
router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Your current password and a new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const { rows } = await pool.query('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    // 400, not 401: a 401 would make the app and the website sign the
    // customer out, and a mistyped current password is not a lost session.
    if (!(await bcrypt.compare(String(currentPassword), rows[0].passwordHash))) {
      return res.status(400).json({ error: 'Your current password is not right' });
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(newPassword), 10), req.userId]);
    res.json({ ok: true });
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
