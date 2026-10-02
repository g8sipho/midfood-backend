// Driver app API. Drivers see orders the kitchen has marked ready, claim one,
// confirm pick-up, stream their location, and mark it delivered.
const express = require('express');
const { pool } = require('../db');
const { requireDriverAuth } = require('../middleware/auth');
const { notifyOrderStatus } = require('../notify');

const router = express.Router();
router.use(requireDriverAuth);

const COLS = `o.id, o.restaurant_name AS "restaurantName", r.address AS "restaurantAddress", r.phone AS "restaurantPhone",
  o.delivery_address AS "deliveryAddress", o.customer_phone AS "customerPhone", u.name AS "customerName",
  o.total::float8 AS total, o.delivery_fee::float8 AS "deliveryFee", o.status, o.notes,
  o.ready_at AS "readyAt", o.created_at AS "createdAt"`;
const FROM = `FROM orders o JOIN restaurants r ON r.id = o.restaurant_id JOIN users u ON u.id = o.user_id`;

async function withItems(orders) {
  for (const o of orders) {
    const { rows } = await pool.query('SELECT name, quantity FROM order_items WHERE order_id = $1', [o.id]);
    o.items = rows;
  }
  return orders;
}

// PATCH /api/driver/status { online: true|false }
router.patch('/status', async (req, res, next) => {
  try {
    const online = !!(req.body && req.body.online);
    await pool.query('UPDATE drivers SET online = $1 WHERE id = $2', [online, req.driverId]);
    res.json({ online });
  } catch (err) { next(err); }
});

// GET /api/driver/orders/available - paid, kitchen-ready, nobody assigned yet
router.get('/orders/available', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} ${FROM}
       WHERE o.payment_status = 'paid' AND o.ready_at IS NOT NULL AND o.driver_id IS NULL
         AND o.status IN ('confirmed','preparing') ORDER BY o.ready_at`
    );
    res.json({ orders: await withItems(rows) });
  } catch (err) { next(err); }
});

// GET /api/driver/orders/mine - this driver's active deliveries
router.get('/orders/mine', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} ${FROM} WHERE o.driver_id = $1 AND o.status <> 'delivered' ORDER BY o.created_at`,
      [req.driverId]
    );
    res.json({ orders: await withItems(rows) });
  } catch (err) { next(err); }
});

// GET /api/driver/orders/history - recent completed deliveries + earnings
router.get('/orders/history', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} ${FROM} WHERE o.driver_id = $1 AND o.status = 'delivered' ORDER BY o.updated_at DESC LIMIT 50`,
      [req.driverId]
    );
    const totals = await pool.query(
      `SELECT COALESCE(SUM(delivery_fee), 0)::float8 AS earnings,
              COALESCE(SUM(delivery_fee) FILTER (WHERE
                (updated_at AT TIME ZONE 'Africa/Johannesburg')::date
                = (now() AT TIME ZONE 'Africa/Johannesburg')::date), 0)::float8 AS "earningsToday"
       FROM orders WHERE driver_id = $1 AND status = 'delivered'`,
      [req.driverId]
    );
    res.json({ orders: rows, earnings: totals.rows[0].earnings, earningsToday: totals.rows[0].earningsToday });
  } catch (err) { next(err); }
});

// POST /api/driver/orders/:id/accept - claim an order (atomic: first driver wins)
router.post('/orders/:id/accept', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET driver_id = $1, updated_at = now()
       WHERE id = $2 AND driver_id IS NULL AND ready_at IS NOT NULL AND payment_status = 'paid'
         AND status IN ('confirmed','preparing')`,
      [req.driverId, req.params.id]
    );
    if (!rowCount) return res.status(409).json({ error: 'Another driver already took this order' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/driver/orders/:id/pickup - driver has the food -> out for delivery
router.post('/orders/:id/pickup', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = 'out_for_delivery', updated_at = now()
       WHERE id = $1 AND driver_id = $2 AND status IN ('confirmed','preparing')`,
      [req.params.id, req.driverId]
    );
    if (!rowCount) return res.status(400).json({ error: 'Order cannot be picked up' });
    notifyOrderStatus(req.params.id, 'out_for_delivery');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/driver/orders/:id/deliver
router.post('/orders/:id/deliver', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = 'delivered', updated_at = now()
       WHERE id = $1 AND driver_id = $2 AND status = 'out_for_delivery'`,
      [req.params.id, req.driverId]
    );
    if (!rowCount) return res.status(400).json({ error: 'Order is not out for delivery' });
    notifyOrderStatus(req.params.id, 'delivered');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/driver/earnings - what this driver is owed and has been paid.
router.get('/earnings', async (req, res, next) => {
  try {
    const pending = await pool.query(
      `SELECT COUNT(*)::int AS "orderCount",
              COALESCE(SUM(delivery_fee), 0)::float8 AS gross,
              COALESCE(SUM(delivery_cut), 0)::float8 AS deductions,
              COALESCE(SUM(driver_payout), 0)::float8 AS amount
       FROM orders
       WHERE driver_id = $1 AND payment_status = 'paid' AND status = 'delivered'
         AND driver_payout_id IS NULL AND driver_payout IS NOT NULL`,
      [req.driverId]
    );
    const paid = await pool.query(
      `SELECT id, order_count AS "orderCount", amount::float8 AS amount, reference,
              period_start AS "periodStart", period_end AS "periodEnd", paid_at AS "paidAt"
       FROM payouts WHERE driver_id = $1 ORDER BY paid_at DESC LIMIT 26`,
      [req.driverId]
    );
    res.json({ pending: pending.rows[0], payouts: paid.rows });
  } catch (err) { next(err); }
});

// POST /api/driver/location { lat, lng } - called every few seconds by the app
router.post('/location', async (req, res, next) => {
  try {
    const { lat, lng } = req.body || {};
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }
    await pool.query('UPDATE drivers SET lat = $1, lng = $2, location_updated_at = now() WHERE id = $3', [
      Number(lat), Number(lng), req.driverId,
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
