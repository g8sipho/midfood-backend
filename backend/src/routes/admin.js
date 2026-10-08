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
const money = require('../money');

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
              (password_hash IS NOT NULL) AS "hasAccount",
              (SELECT COUNT(*)::int FROM menu_items m WHERE m.restaurant_id = restaurants.id) AS "menuCount"
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
       VALUES ($1, $2, $3, $4, $5, 4.5, $6, $7, $8, ${money.FREE_UNTIL_SQL})`,
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
      // A real calendar date: "2027-02-30" looks right and is not.
      const real = (d) => {
        const t = new Date(`${d}T00:00:00Z`);
        return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
      };
      if (until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !real(until))) {
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

// --- A restaurant's menu, managed by the owner of MidFood --------------------
//
// Most small kitchens will not type their own menu in. These routes let the
// admin page load and maintain a menu on a restaurant's behalf, without ever
// needing that restaurant's password. The restaurant can still edit the same
// menu from its own portal.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One dish, cleaned up. Returns { name, description, price } or an error string.
function cleanDish(raw) {
  const name = String((raw && raw.name) || '').trim();
  const description = String((raw && raw.description) || '').trim();
  const price = Number(raw && raw.price);
  if (!name) return 'Every dish needs a name';
  if (name.length > 120) return `"${name.slice(0, 30)}…" is too long for a dish name (120 characters at most)`;
  if (description.length > 400) return `The description for "${name}" is too long (400 characters at most)`;
  if (raw.price === '' || raw.price === null || raw.price === undefined || !Number.isFinite(price) || price < 0 || price > 100000) {
    return `"${name}" needs a price in rand, e.g. 45 or 45.50`;
  }
  return { name, description, price: Math.round(price * 100) / 100 };
}

// GET /api/admin/restaurants/:id/menu - every dish, sold-out ones included
router.get('/restaurants/:id/menu', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Restaurant not found' });
    const r = await pool.query('SELECT id, name FROM restaurants WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    const { rows } = await pool.query(
      `SELECT id, name, description, price::float8 AS price, available
       FROM menu_items WHERE restaurant_id = $1 ORDER BY name`,
      [req.params.id]
    );
    res.json({ restaurant: r.rows[0], menu: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/restaurants/:id/menu { items: [{ name, description?, price }] }
// Adds one dish or a whole menu. All or nothing: if any line is wrong, none
// are added, so a half-loaded menu never reaches customers. A dish whose name
// is already on the menu is skipped rather than duplicated, which makes it
// safe to paste the same list twice.
router.post('/restaurants/:id/menu', async (req, res, next) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Restaurant not found' });
  const list = req.body && Array.isArray(req.body.items) ? req.body.items : null;
  if (!list || list.length === 0) return res.status(400).json({ error: 'Send at least one dish' });
  if (list.length > 300) return res.status(400).json({ error: 'That is more than 300 dishes at once. Add them in smaller batches.' });

  const dishes = [];
  for (const raw of list) {
    const dish = cleanDish(raw);
    if (typeof dish === 'string') return res.status(400).json({ error: dish });
    dishes.push(dish);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    const existing = await client.query('SELECT lower(name) AS name FROM menu_items WHERE restaurant_id = $1', [req.params.id]);
    const taken = new Set(existing.rows.map((x) => x.name));
    const added = [];
    const skipped = [];
    for (const dish of dishes) {
      const key = dish.name.toLowerCase();
      if (taken.has(key)) { skipped.push(dish.name); continue; }
      taken.add(key);
      const id = uuid();
      await client.query(
        'INSERT INTO menu_items (id, restaurant_id, name, description, price) VALUES ($1, $2, $3, $4, $5)',
        [id, req.params.id, dish.name, dish.description, dish.price]
      );
      added.push({ id, ...dish, available: true });
    }
    await client.query('COMMIT');
    res.status(201).json({ added, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/admin/menu/:itemId { name?, description?, price?, available? }
router.patch('/menu/:itemId', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.itemId)) return res.status(404).json({ error: 'Dish not found' });
    const body = req.body || {};
    const cur = await pool.query(
      'SELECT name, description, price::float8 AS price, available FROM menu_items WHERE id = $1',
      [req.params.itemId]
    );
    if (!cur.rows[0]) return res.status(404).json({ error: 'Dish not found' });
    const merged = cleanDish({
      name: body.name !== undefined ? body.name : cur.rows[0].name,
      description: body.description !== undefined ? body.description : cur.rows[0].description,
      price: body.price !== undefined ? body.price : cur.rows[0].price,
    });
    if (typeof merged === 'string') return res.status(400).json({ error: merged });
    if (body.available !== undefined && typeof body.available !== 'boolean') {
      return res.status(400).json({ error: 'available must be true or false' });
    }
    const available = body.available !== undefined ? body.available : cur.rows[0].available;
    const { rows } = await pool.query(
      `UPDATE menu_items SET name = $1, description = $2, price = $3, available = $4 WHERE id = $5
       RETURNING id, name, description, price::float8 AS price, available`,
      [merged.name, merged.description, merged.price, available, req.params.itemId]
    );
    res.json({ item: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/menu/:itemId - take a dish off the menu for good. Past
// orders keep their own copy of what was ordered, so nothing is lost.
router.delete('/menu/:itemId', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.itemId)) return res.status(404).json({ error: 'Dish not found' });
    const { rowCount } = await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.itemId]);
    if (!rowCount) return res.status(404).json({ error: 'Dish not found' });
    res.status(204).end();
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
    if (phone && !money.isPhone(phone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number, e.g. 082 123 4567' });
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
  o.created_at AS "createdAt", o.paid_at AS "paidAt", o.updated_at AS "updatedAt"`;
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

    // The same customer charged twice for one order: the second payment is
    // owed straight back, whatever happened to the order itself.
    const extras = await pool.query(
      `SELECT x.pf_payment_id AS "paymentReference", x.amount::float8 AS total, x.received_at AS "updatedAt",
              o.id AS "orderId", o.restaurant_name AS "restaurantName", u.name AS "customerName",
              u.email AS "customerEmail", o.customer_phone AS "customerPhone"
       FROM extra_payments x JOIN orders o ON o.id = x.order_id JOIN users u ON u.id = o.user_id
       WHERE x.refunded_at IS NULL ORDER BY x.received_at`
    );
    for (const x of extras.rows) x.kind = 'duplicate';
    for (const o of refunds.rows) o.kind = 'order';

    // Paid orders in flight. `waitingMinutes` is how long the customer has
    // been waiting since they paid, which is when the kitchen first saw it.
    const live = await pool.query(
      `SELECT ${ADMIN_ORDER_COLS},
              FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(o.paid_at, o.created_at))) / 60)::int AS "waitingMinutes"
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
    const s = stats.rows[0];
    s.refundsDue = money.money(s.refundsDue + extras.rows.reduce((sum, x) => sum + x.total, 0));
    res.json({ orders: rows, live: live.rows, refundsDue: refunds.rows.concat(extras.rows), stats: s });
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

// POST /api/admin/extra-payments/:pfPaymentId/refunded { reference } - record
// that a double payment has been sent back. Once, like an order refund.
router.post('/extra-payments/:pfPaymentId/refunded', async (req, res, next) => {
  try {
    const reference = String((req.body && req.body.reference) || '').trim() || null;
    const { rows } = await pool.query(
      `UPDATE extra_payments SET refunded_at = now(), refund_reference = $1
       WHERE pf_payment_id = $2 AND refunded_at IS NULL
       RETURNING pf_payment_id, refunded_at AS "refundedAt"`,
      [reference, req.params.pfPaymentId]
    );
    if (!rows[0]) return res.status(400).json({ error: 'There is no refund outstanding on this payment' });
    res.json({ ok: true, refundedAt: rows[0].refundedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
