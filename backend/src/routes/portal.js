// Restaurant portal API: lets a logged-in restaurant manage its own menu.
// Every route here is scoped to req.restaurantId (set by requireRestaurantAuth),
// so a restaurant can only ever see or change its own items.
const express = require('express');
const { pool, uuid } = require('../db');
const { requireRestaurantAuth } = require('../middleware/auth');
const { notifyOrderStatus } = require('../notify');

const router = express.Router();
router.use(requireRestaurantAuth);

function isValidPrice(price) {
  return price != null && !Number.isNaN(Number(price)) && Number(price) >= 0;
}

// GET /api/portal/restaurant - this restaurant's own public listing info
router.get('/restaurant', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, cuisine, eta_minutes AS "etaMinutes", delivery_fee::float8 AS "deliveryFee",
              rating::float8 AS rating, hero_color AS "heroColor", username, open, approved,
              phone, address
       FROM restaurants WHERE id = $1`,
      [req.restaurantId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/menu - full menu, including sold-out items (unlike the
// public /api/restaurants/:id endpoint, which hides sold-out items)
router.get('/menu', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, price::float8 AS price, available
       FROM menu_items WHERE restaurant_id = $1 ORDER BY name`,
      [req.restaurantId]
    );
    res.json({ menu: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/menu - add a new menu item
router.post('/menu', async (req, res, next) => {
  try {
    const { name, description, price } = req.body || {};
    if (!name || !description || !isValidPrice(price)) {
      return res.status(400).json({ error: 'name, description and a non-negative price are required' });
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO menu_items (id, restaurant_id, name, description, price, available)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [id, req.restaurantId, name, description, price]
    );
    res.status(201).json({ item: { id, name, description, price: Number(price), available: true } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/portal/menu/:id - edit an existing item's name/description/price
router.put('/menu/:id', async (req, res, next) => {
  try {
    const { name, description, price } = req.body || {};
    if (!name || !description || !isValidPrice(price)) {
      return res.status(400).json({ error: 'name, description and a non-negative price are required' });
    }

    const { rows } = await pool.query(
      `UPDATE menu_items SET name = $1, description = $2, price = $3
       WHERE id = $4 AND restaurant_id = $5
       RETURNING id, name, description, price::float8 AS price, available`,
      [name, description, price, req.params.id, req.restaurantId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/portal/menu/:id/availability - mark an item sold out / back in stock
router.patch('/menu/:id/availability', async (req, res, next) => {
  try {
    const { available } = req.body || {};
    if (typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available must be true or false' });
    }

    const { rows } = await pool.query(
      `UPDATE menu_items SET available = $1 WHERE id = $2 AND restaurant_id = $3
       RETURNING id, available`,
      [available, req.params.id, req.restaurantId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/portal/menu/:id - remove an item entirely
router.delete('/menu/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2',
      [req.params.id, req.restaurantId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Live order handling. Replaces the old "tap to simulate" button in the app:
// the kitchen now really accepts, prepares and hands orders over to a driver.
// Only paid orders are shown -- an abandoned checkout never reaches a kitchen.
// ---------------------------------------------------------------------------

const ORDER_COLS = `o.id, u.name AS "customerName", o.customer_phone AS "customerPhone",
  o.delivery_address AS "deliveryAddress", o.subtotal::float8 AS subtotal,
  o.delivery_fee::float8 AS "deliveryFee", o.total::float8 AS total, o.status, o.notes,
  o.payment_status AS "paymentStatus", o.ready_at AS "readyAt",
  o.created_at AS "createdAt", o.updated_at AS "updatedAt",
  d.name AS "driverName", d.phone AS "driverPhone"`;
const ORDER_FROM = `FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN drivers d ON d.id = o.driver_id`;

async function attachOrderItems(orders) {
  for (const o of orders) {
    const { rows } = await pool.query(
      'SELECT name, price::float8 AS price, quantity FROM order_items WHERE order_id = $1',
      [o.id]
    );
    o.items = rows;
  }
  return orders;
}

// GET /api/portal/orders - live board: everything not yet delivered.
// The portal polls this every few seconds.
router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ORDER_COLS} ${ORDER_FROM}
       WHERE o.restaurant_id = $1 AND o.payment_status = 'paid' AND o.status <> 'delivered'
       ORDER BY o.created_at`,
      [req.restaurantId]
    );
    res.json({ orders: await attachOrderItems(rows) });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/orders/history - delivered orders + today's takings
router.get('/orders/history', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ORDER_COLS} ${ORDER_FROM}
       WHERE o.restaurant_id = $1 AND o.status = 'delivered' AND o.payment_status = 'paid'
       ORDER BY o.updated_at DESC LIMIT 100`,
      [req.restaurantId]
    );
    // Totals are computed in SQL against the South African business day, so
    // they don't drift with the server's own timezone.
    const totals = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(subtotal), 0)::float8 AS takings
       FROM orders
       WHERE restaurant_id = $1 AND status = 'delivered' AND payment_status = 'paid'
         AND (updated_at AT TIME ZONE 'Africa/Johannesburg')::date
             = (now() AT TIME ZONE 'Africa/Johannesburg')::date`,
      [req.restaurantId]
    );
    res.json({
      orders: await attachOrderItems(rows),
      todayCount: totals.rows[0].count,
      todayTakings: totals.rows[0].takings,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/orders/:id/accept - kitchen takes the order
router.post('/orders/:id/accept', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = 'confirmed', updated_at = now()
       WHERE id = $1 AND restaurant_id = $2 AND status = 'placed' AND payment_status = 'paid'`,
      [req.params.id, req.restaurantId]
    );
    if (!rowCount) return res.status(400).json({ error: 'That order can no longer be accepted' });
    notifyOrderStatus(req.params.id, 'confirmed');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/orders/:id/reject { reason }
router.post('/orders/:id/reject', async (req, res, next) => {
  try {
    const reason = (req.body && req.body.reason) || 'The restaurant could not take this order';
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = 'rejected', rejected_reason = $1, updated_at = now()
       WHERE id = $2 AND restaurant_id = $3 AND status = 'placed'`,
      [reason, req.params.id, req.restaurantId]
    );
    if (!rowCount) return res.status(400).json({ error: 'That order can no longer be declined' });
    notifyOrderStatus(req.params.id, 'rejected');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/orders/:id/preparing
router.post('/orders/:id/preparing', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = 'preparing', updated_at = now()
       WHERE id = $1 AND restaurant_id = $2 AND status = 'confirmed'`,
      [req.params.id, req.restaurantId]
    );
    if (!rowCount) return res.status(400).json({ error: 'Order is not in a state to start preparing' });
    notifyOrderStatus(req.params.id, 'preparing');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/orders/:id/ready - food is up; drivers can now claim it
router.post('/orders/:id/ready', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET ready_at = now(), updated_at = now()
       WHERE id = $1 AND restaurant_id = $2 AND status IN ('confirmed','preparing') AND ready_at IS NULL`,
      [req.params.id, req.restaurantId]
    );
    if (!rowCount) return res.status(400).json({ error: 'Order is not ready to be handed over' });
    notifyOrderStatus(req.params.id, 'ready');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/earnings - what this restaurant is owed and has been paid.
// The kitchen sees its own money without having to ask MidFood.
router.get('/earnings', async (req, res, next) => {
  try {
    const pending = await pool.query(
      `SELECT COUNT(*)::int AS "orderCount",
              COALESCE(SUM(subtotal), 0)::float8 AS gross,
              COALESCE(SUM(commission), 0)::float8 AS commission,
              COALESCE(SUM(restaurant_payout), 0)::float8 AS amount
       FROM orders
       WHERE restaurant_id = $1 AND payment_status = 'paid' AND status = 'delivered'
         AND restaurant_payout_id IS NULL AND restaurant_payout IS NOT NULL`,
      [req.restaurantId]
    );

    const paid = await pool.query(
      `SELECT id, order_count AS "orderCount", gross::float8 AS gross,
              deductions::float8 AS commission, amount::float8 AS amount,
              reference, period_start AS "periodStart", period_end AS "periodEnd",
              paid_at AS "paidAt"
       FROM payouts WHERE restaurant_id = $1 ORDER BY paid_at DESC LIMIT 26`,
      [req.restaurantId]
    );

    const terms = await pool.query(
      `SELECT free_until AS "freeUntil", commission_rate::float8 AS "ownRate",
              (SELECT value FROM settings WHERE key = 'commission_rate')::float8 AS "defaultRate"
       FROM restaurants WHERE id = $1`,
      [req.restaurantId]
    );
    const t = terms.rows[0] || {};
    const inFreePeriod = !!(t.freeUntil && new Date(t.freeUntil) >= new Date());

    res.json({
      pending: pending.rows[0],
      payouts: paid.rows,
      terms: {
        freeUntil: t.freeUntil,
        inFreePeriod,
        rate: inFreePeriod ? 0 : (t.ownRate != null ? t.ownRate : t.defaultRate),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/portal/open { open: true|false } - "we're closed" switch
router.patch('/open', async (req, res, next) => {
  try {
    const open = !!(req.body && req.body.open);
    await pool.query('UPDATE restaurants SET open = $1 WHERE id = $2', [open, req.restaurantId]);
    res.json({ open });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
