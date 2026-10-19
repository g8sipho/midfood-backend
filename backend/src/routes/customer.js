// The signed-in customer's own things: saved addresses and favourite
// restaurants. Both are theirs alone - every query is scoped to req.userId.
const express = require('express');
const { pool, uuid } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_ADDRESSES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADDRESS_COLUMNS = `id, label, line, lat, lng, created_at AS "createdAt", last_used_at AS "lastUsedAt"`;

function cleanAddress(body) {
  const label = String((body && body.label) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const line = String((body && body.line) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!label) return { error: 'Give the address a name, like Home or Work.' };
  if (!line) return { error: 'The address itself is required.' };
  let lat = null;
  let lng = null;
  if (body.lat != null && body.lng != null && body.lat !== '' && body.lng !== '') {
    lat = Number(body.lat);
    lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      lat = null;
      lng = null;
    }
  }
  return { label, line, lat, lng };
}

// --- Saved addresses -------------------------------------------------------

// GET /api/customer/addresses - most recently used first.
router.get('/addresses', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE user_id = $1 ORDER BY last_used_at DESC, created_at DESC`,
      [req.userId]
    );
    res.json({ addresses: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/customer/addresses { label, line, lat?, lng? }
// Saving "Home" again replaces the old Home rather than making a second one.
router.post('/addresses', async (req, res, next) => {
  try {
    const a = cleanAddress(req.body || {});
    if (a.error) return res.status(400).json({ error: a.error });

    const existing = await pool.query(
      'SELECT id FROM addresses WHERE user_id = $1 AND lower(label) = lower($2)',
      [req.userId, a.label]
    );
    if (existing.rows[0]) {
      const { rows } = await pool.query(
        `UPDATE addresses SET label = $1, line = $2, lat = $3, lng = $4, last_used_at = now()
         WHERE id = $5 RETURNING ${ADDRESS_COLUMNS}`,
        [a.label, a.line, a.lat, a.lng, existing.rows[0].id]
      );
      return res.json({ address: rows[0] });
    }

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM addresses WHERE user_id = $1', [req.userId]);
    if (count.rows[0].n >= MAX_ADDRESSES) {
      return res.status(400).json({ error: `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO addresses (id, user_id, label, line, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ADDRESS_COLUMNS}`,
      [uuid(), req.userId, a.label, a.line, a.lat, a.lng]
    );
    res.status(201).json({ address: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/customer/addresses/:id { label, line, lat?, lng? }
router.put('/addresses/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Address not found' });
    const a = cleanAddress(req.body || {});
    if (a.error) return res.status(400).json({ error: a.error });
    const { rows } = await pool.query(
      `UPDATE addresses SET label = $1, line = $2, lat = $3, lng = $4
       WHERE id = $5 AND user_id = $6 RETURNING ${ADDRESS_COLUMNS}`,
      [a.label, a.line, a.lat, a.lng, req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Address not found' });
    res.json({ address: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customer/addresses/:id
router.delete('/addresses/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Address not found' });
    const { rowCount } = await pool.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!rowCount) return res.status(404).json({ error: 'Address not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Favourite restaurants -------------------------------------------------

// GET /api/customer/favourites -> { restaurantIds: [...] }
router.get('/favourites', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.restaurant_id AS id FROM favourites f JOIN restaurants r ON r.id = f.restaurant_id
       WHERE f.user_id = $1 AND r.approved = true ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json({ restaurantIds: rows.map((r) => r.id) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/customer/favourites/:restaurantId - heart it (idempotent)
router.put('/favourites/:restaurantId', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.restaurantId)) return res.status(404).json({ error: 'Restaurant not found' });
    const r = await pool.query('SELECT id FROM restaurants WHERE id = $1 AND approved = true', [req.params.restaurantId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    await pool.query(
      'INSERT INTO favourites (user_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, req.params.restaurantId]
    );
    res.json({ ok: true, favourite: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customer/favourites/:restaurantId - un-heart it
router.delete('/favourites/:restaurantId', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.restaurantId)) return res.status(404).json({ error: 'Restaurant not found' });
    await pool.query('DELETE FROM favourites WHERE user_id = $1 AND restaurant_id = $2', [req.userId, req.params.restaurantId]);
    res.json({ ok: true, favourite: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
