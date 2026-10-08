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
const { notifyOrderStatus } = require('../notify');

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
              rating::float8 AS rating, hero_color AS "heroColor", username, approved, open,
              phone, address, free_until::text AS "freeUntil", commission_rate::float8 AS "commissionRate",
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
      `INSERT INTO restaurants (id, name, cuisine, eta_minutes, delivery_fee, rating, hero_color, username, password_hash, free_until)
       VALUES ($1, $2, $3, $4, $5, 4.5, $6, $7, $8,
               (now() + ((SELECT value FROM settings WHERE key = 'free_months')::int || ' months')::interval)::date)`,
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

// PATCH /api/admin/restaurants/:id - change a restaurant's terms.
// Body, all optional: { deliveryFee, etaMinutes, freeUntil, commissionRate }
//   freeUntil       'YYYY-MM-DD', or null for no free period
//   commissionRate  a fraction (0.12 = 12%), or null to use the platform default
// Like every rate change, this only affects orders paid for from now on.
router.patch('/restaurants/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sets = [];
    const values = [];
    const set = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (body.deliveryFee !== undefined) {
      const fee = Number(body.deliveryFee);
      if (body.deliveryFee === null || body.deliveryFee === '' || !Number.isFinite(fee) || fee < 0 || fee > 500) {
        return res.status(400).json({ error: 'deliveryFee must be between R0 and R500' });
      }
      set('delivery_fee', fee);
    }
    if (body.etaMinutes !== undefined) {
      const eta = Number(body.etaMinutes);
      if (!Number.isInteger(eta) || eta < 5 || eta > 180) {
        return res.status(400).json({ error: 'etaMinutes must be a whole number from 5 to 180' });
      }
      set('eta_minutes', eta);
    }
    if (body.freeUntil !== undefined) {
      const until = body.freeUntil === null || body.freeUntil === '' ? null : String(body.freeUntil);
      if (until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until)))) {
        return res.status(400).json({ error: 'freeUntil must be a date like 2027-01-31, or empty' });
      }
      set('free_until', until);
    }
    if (body.commissionRate !== undefined) {
      const none = body.commissionRate === null || body.commissionRate === '';
      const rate = Number(body.commissionRate);
      if (!none && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
        return res.status(400).json({ error: 'commissionRate must be between 0 and 1 (0.15 = 15%), or empty' });
      }
      set('commission_rate', none ? null : rate);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE restaurants SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, delivery_fee::float8 AS "deliveryFee", eta_minutes AS "etaMinutes",
                 free_until::text AS "freeUntil", commission_rate::float8 AS "commissionRate"`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/restaurants/:id - remove a restaurant entirely (its menu
// items go with it). Meant for cleaning up test entries; a restaurant that
// already has real orders can't be deleted (orders keep a reference to it),
// so this fails with a clear message instead of a raw database error.
router.delete('/restaurants/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM restaurants WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'This restaurant already has orders on it, so it can\'t be deleted. Remove it from the app instead by having it mark all menu items sold out.',
      });
    }
    next(err);
  }
});

// POST /api/admin/restaurants/:id/approve - let a self-signed-up restaurant
// go live (it stays hidden from customers until this happens)
router.post('/restaurants/:id/approve', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE restaurants SET approved = true WHERE id = $1 RETURNING id, name, approved',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/restaurants/:id/suspend - take a restaurant back offline
router.post('/restaurants/:id/suspend', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE restaurants SET approved = false WHERE id = $1 RETURNING id, name, approved',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: rows[0] });
  } catch (err) {
    next(err);
  }
});

// --- Drivers ---------------------------------------------------------------

router.get('/drivers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.phone, d.username, d.approved, d.online, d.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM orders o WHERE o.driver_id = d.id AND o.status = 'delivered') AS deliveries
       FROM drivers d ORDER BY d.approved, d.name`
    );
    res.json({ drivers: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/drivers', async (req, res, next) => {
  try {
    const { name, phone, username, password } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'name, username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const u = normalizeUsername(username);
    const existing = await pool.query('SELECT id FROM drivers WHERE username = $1', [u]);
    if (existing.rows.length) return res.status(409).json({ error: 'That username is already taken' });
    const id = uuid();
    await pool.query(
      'INSERT INTO drivers (id, name, phone, username, password_hash, approved) VALUES ($1,$2,$3,$4,$5,true)',
      [id, name, phone || null, u, await bcrypt.hash(password, 10)]
    );
    res.status(201).json({ driver: { id, name, username: u } });
  } catch (err) {
    next(err);
  }
});

router.post('/drivers/:id/approve', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE drivers SET approved = true WHERE id = $1 RETURNING id, name, approved',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Driver not found' });
    res.json({ driver: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/drivers/:id/suspend', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE drivers SET approved = false, online = false WHERE id = $1 RETURNING id, name, approved',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Driver not found' });
    res.json({ driver: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/orders - everything happening right now, across the platform
const ADMIN_ORDER_COLS = `o.id, o.restaurant_name AS "restaurantName", u.name AS "customerName",
  u.email AS "customerEmail", o.customer_phone AS "customerPhone",
  o.total::float8 AS total, o.status, o.payment_status AS "paymentStatus",
  o.payment_reference AS "paymentReference", o.rejected_reason AS "rejectedReason",
  o.cancelled_by AS "cancelledBy", o.refunded_at AS "refundedAt",
  o.refund_reference AS "refundReference",
  o.ready_at AS "readyAt", d.name AS "driverName",
  o.created_at AS "createdAt", o.updated_at AS "updatedAt"`;
const ADMIN_ORDER_FROM = `FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN drivers d ON d.id = o.driver_id`;

// A kitchen that has not answered a paid order in this long needs a phone call.
const STUCK_AFTER_MINUTES = 10;

router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADMIN_ORDER_COLS} ${ADMIN_ORDER_FROM} ORDER BY o.created_at DESC LIMIT 100`
    );

    // Money owed back to customers: paid for, then declined or cancelled, and
    // not yet recorded as refunded. Never limited, so none can scroll away.
    const refunds = await pool.query(
      `SELECT ${ADMIN_ORDER_COLS} ${ADMIN_ORDER_FROM}
       WHERE o.payment_status = 'paid' AND o.status = 'rejected' AND o.refunded_at IS NULL
       ORDER BY o.updated_at`
    );

    // Paid orders in flight. `waitingMinutes` is how long the customer has
    // been waiting on a kitchen that has not accepted yet.
    const live = await pool.query(
      `SELECT ${ADMIN_ORDER_COLS},
              FLOOR(EXTRACT(EPOCH FROM (now() - o.created_at)) / 60)::int AS "waitingMinutes"
       ${ADMIN_ORDER_FROM}
       WHERE o.payment_status = 'paid' AND o.status NOT IN ('delivered', 'rejected')
       ORDER BY o.created_at`
    );
    for (const o of live.rows) {
      o.stuck = o.status === 'placed' && o.waitingMinutes >= STUCK_AFTER_MINUTES;
    }

    // Computed in SQL over ALL orders (not just the 100 listed above) and
    // against the South African business day. Declined and cancelled orders
    // are refunded, so they are not sales.
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE payment_status = 'paid' AND status NOT IN ('delivered','rejected'))::int AS live,
         COUNT(*) FILTER (WHERE payment_status = 'paid' AND status = 'delivered'
           AND (updated_at AT TIME ZONE 'Africa/Johannesburg')::date
               = (now() AT TIME ZONE 'Africa/Johannesburg')::date)::int AS "deliveredToday",
         COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND status <> 'rejected'), 0)::float8 AS gmv,
         COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND status = 'rejected'
           AND refunded_at IS NULL), 0)::float8 AS "refundsDue"
       FROM orders`
    );
    res.json({ orders: rows, live: live.rows, refundsDue: refunds.rows, stats: stats.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/orders/:id/cancel { reason } - stop a paid order that will
// not be fulfilled (kitchen not answering, no driver, customer phoned in).
// It becomes a refund you owe. Not allowed once the driver has the food.
router.post('/orders/:id/cancel', async (req, res, next) => {
  try {
    const reason = String((req.body && req.body.reason) || '').trim() || 'Cancelled by MidFood';
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'rejected', rejected_reason = $1, cancelled_by = 'admin', updated_at = now()
       WHERE id = $2 AND status IN ('placed', 'confirmed', 'preparing')
       RETURNING id, payment_status AS "paymentStatus"`,
      [reason.slice(0, 300), req.params.id]
    );
    if (!rows[0]) {
      return res.status(400).json({
        error: 'This order can no longer be cancelled. It is already out for delivery, delivered or cancelled.',
      });
    }
    notifyOrderStatus(req.params.id, 'rejected');
    res.json({ ok: true, refundDue: rows[0].paymentStatus === 'paid' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/orders/:id/refunded { reference } - record that the money
// has gone back to the customer. Do the refund in PayFast first; this only
// records it. It can be recorded once.
router.post('/orders/:id/refunded', async (req, res, next) => {
  try {
    const reference = String((req.body && req.body.reference) || '').trim() || null;
    const { rows } = await pool.query(
      `UPDATE orders SET refunded_at = now(), refund_reference = $1
       WHERE id = $2 AND payment_status = 'paid' AND status = 'rejected' AND refunded_at IS NULL
       RETURNING id, refunded_at AS "refundedAt"`,
      [reference, req.params.id]
    );
    if (!rows[0]) {
      return res.status(400).json({ error: 'There is no refund outstanding on this order' });
    }
    res.json({ ok: true, refundedAt: rows[0].refundedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
