// Payouts: what MidFood owes, and recording that it has been paid.
//
// Admin-only. Everything here is money, so each route is deliberate about
// which orders it touches: a payout claims exactly the orders it was
// calculated from, inside one transaction, so the same order can never be
// paid out twice even if two people press the button at once.
const express = require('express');
const { pool, uuid } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const money = require('../money');

const router = express.Router();
router.use(requireAdmin);

// GET /api/payouts/owing - everyone MidFood currently owes, and what it kept.
router.get('/owing', async (req, res, next) => {
  try {
    const restaurants = await pool.query(
      `SELECT r.id, r.name, r.phone, r.bank_name AS "bankName",
              r.bank_account_name AS "bankAccountName", r.bank_account_number AS "bankAccountNumber",
              COUNT(o.id)::int AS "orderCount",
              COALESCE(SUM(o.subtotal), 0)::float8 AS gross,
              COALESCE(SUM(o.commission), 0)::float8 AS deductions,
              COALESCE(SUM(o.restaurant_payout), 0)::float8 AS amount,
              MIN(o.updated_at) AS oldest
       FROM restaurants r
       JOIN orders o ON o.restaurant_id = r.id
        AND o.payment_status = 'paid' AND o.status = 'delivered'
        AND o.restaurant_payout_id IS NULL AND o.restaurant_payout IS NOT NULL
       GROUP BY r.id ORDER BY amount DESC`
    );

    const drivers = await pool.query(
      `SELECT d.id, d.name, d.phone, d.bank_name AS "bankName",
              d.bank_account_name AS "bankAccountName", d.bank_account_number AS "bankAccountNumber",
              COUNT(o.id)::int AS "orderCount",
              COALESCE(SUM(o.delivery_fee), 0)::float8 AS gross,
              COALESCE(SUM(o.delivery_cut), 0)::float8 AS deductions,
              COALESCE(SUM(o.driver_payout), 0)::float8 AS amount,
              MIN(o.updated_at) AS oldest
       FROM drivers d
       JOIN orders o ON o.driver_id = d.id
        AND o.payment_status = 'paid' AND o.status = 'delivered'
        AND o.driver_payout_id IS NULL AND o.driver_payout IS NOT NULL
       GROUP BY d.id ORDER BY amount DESC`
    );

    // What MidFood has earned but not yet drawn down — commission on orders
    // still awaiting payout, plus commission on orders already settled.
    const earned = await pool.query(
      `SELECT COALESCE(SUM(commission), 0)::float8 AS commission,
              COALESCE(SUM(delivery_cut), 0)::float8 AS "deliveryCut",
              COUNT(*)::int AS "orderCount"
       FROM orders WHERE payment_status = 'paid' AND status = 'delivered'`
    );

    res.json({
      restaurants: restaurants.rows,
      drivers: drivers.rows,
      owed: {
        restaurants: restaurants.rows.reduce((s, r) => s + r.amount, 0),
        drivers: drivers.rows.reduce((s, d) => s + d.amount, 0),
      },
      earned: earned.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/payouts/statement/:type/:id - the line-by-line statement behind a
// payout, so a restaurant can check every order it is being paid for.
router.get('/statement/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (type !== 'restaurant' && type !== 'driver') {
      return res.status(400).json({ error: 'type must be restaurant or driver' });
    }

    const isRestaurant = type === 'restaurant';
    const { rows } = await pool.query(
      `SELECT o.id, o.created_at AS "createdAt", o.updated_at AS "deliveredAt",
              o.restaurant_name AS "restaurantName", u.name AS "customerName",
              o.subtotal::float8 AS subtotal, o.delivery_fee::float8 AS "deliveryFee",
              o.total::float8 AS total, o.commission::float8 AS commission,
              o.commission_rate::float8 AS "commissionRate",
              o.restaurant_payout::float8 AS "restaurantPayout",
              o.delivery_cut::float8 AS "deliveryCut",
              o.driver_payout::float8 AS "driverPayout"
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE ${isRestaurant ? 'o.restaurant_id' : 'o.driver_id'} = $1
         AND o.payment_status = 'paid' AND o.status = 'delivered'
         AND ${isRestaurant ? 'o.restaurant_payout_id' : 'o.driver_payout_id'} IS NULL
         AND ${isRestaurant ? 'o.restaurant_payout' : 'o.driver_payout'} IS NOT NULL
       ORDER BY o.updated_at`,
      [id]
    );

    const payee = await pool.query(
      isRestaurant
        ? `SELECT name, phone, address, bank_name AS "bankName",
                  bank_account_name AS "bankAccountName", bank_account_number AS "bankAccountNumber"
           FROM restaurants WHERE id = $1`
        : `SELECT name, phone, bank_name AS "bankName",
                  bank_account_name AS "bankAccountName", bank_account_number AS "bankAccountNumber"
           FROM drivers WHERE id = $1`,
      [id]
    );
    if (!payee.rows[0]) return res.status(404).json({ error: 'Not found' });

    const amountOf = (o) => (isRestaurant ? o.restaurantPayout : o.driverPayout);
    const grossOf = (o) => (isRestaurant ? o.subtotal : o.deliveryFee);
    const dedOf = (o) => (isRestaurant ? o.commission : o.deliveryCut);

    res.json({
      payee: payee.rows[0],
      type,
      orders: rows,
      totals: {
        orderCount: rows.length,
        gross: money.money(rows.reduce((s, o) => s + grossOf(o), 0)),
        deductions: money.money(rows.reduce((s, o) => s + dedOf(o), 0)),
        amount: money.money(rows.reduce((s, o) => s + amountOf(o), 0)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/payouts/:type/:id - record that a payee has been paid.
//
// The whole point of this route is that it must never pay the same order
// twice. It claims the orders and writes the payout inside one transaction,
// and the amount is summed from the rows it actually claimed, not from
// anything the caller sends.
router.post('/:type/:id', async (req, res, next) => {
  const { type, id } = req.params;
  if (type !== 'restaurant' && type !== 'driver') {
    return res.status(400).json({ error: 'type must be restaurant or driver' });
  }
  const isRestaurant = type === 'restaurant';
  const payoutCol = isRestaurant ? 'restaurant_payout_id' : 'driver_payout_id';
  const amountCol = isRestaurant ? 'restaurant_payout' : 'driver_payout';
  const grossCol = isRestaurant ? 'subtotal' : 'delivery_fee';
  const dedCol = isRestaurant ? 'commission' : 'delivery_cut';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the unpaid orders for this payee so a second press of the button
    // waits here and then finds nothing left to claim.
    const { rows: claimable } = await client.query(
      `SELECT id, ${grossCol}::float8 AS gross, ${dedCol}::float8 AS ded,
              ${amountCol}::float8 AS amount, updated_at AS "deliveredAt"
       FROM orders
       WHERE ${isRestaurant ? 'restaurant_id' : 'driver_id'} = $1
         AND payment_status = 'paid' AND status = 'delivered'
         AND ${payoutCol} IS NULL AND ${amountCol} IS NOT NULL
       ORDER BY updated_at
       FOR UPDATE`,
      [id]
    );

    if (claimable.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'There is nothing outstanding to pay out' });
    }

    const payoutId = uuid();
    const gross = money.money(claimable.reduce((s, o) => s + o.gross, 0));
    const deductions = money.money(claimable.reduce((s, o) => s + o.ded, 0));
    const amount = money.money(claimable.reduce((s, o) => s + o.amount, 0));
    const periodStart = claimable[0].deliveredAt;
    const periodEnd = claimable[claimable.length - 1].deliveredAt;

    await client.query(
      `INSERT INTO payouts (id, payee_type, restaurant_id, driver_id, period_start, period_end,
                            order_count, gross, deductions, amount, reference, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        payoutId, type,
        isRestaurant ? id : null,
        isRestaurant ? null : id,
        periodStart, periodEnd,
        claimable.length, gross, deductions, amount,
        (req.body && req.body.reference) || null,
        (req.body && req.body.note) || null,
      ]
    );

    await client.query(
      `UPDATE orders SET ${payoutCol} = $1 WHERE id = ANY($2::uuid[])`,
      [payoutId, claimable.map((o) => o.id)]
    );

    await client.query('COMMIT');
    res.status(201).json({
      payout: { id: payoutId, type, orderCount: claimable.length, gross, deductions, amount },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/payouts/history - what has already been paid.
router.get('/history', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.payee_type AS "payeeType", p.order_count AS "orderCount",
              p.gross::float8 AS gross, p.deductions::float8 AS deductions,
              p.amount::float8 AS amount, p.reference, p.note,
              p.period_start AS "periodStart", p.period_end AS "periodEnd", p.paid_at AS "paidAt",
              COALESCE(r.name, d.name) AS "payeeName"
       FROM payouts p
       LEFT JOIN restaurants r ON r.id = p.restaurant_id
       LEFT JOIN drivers d ON d.id = p.driver_id
       ORDER BY p.paid_at DESC LIMIT 200`
    );
    res.json({ payouts: rows });
  } catch (err) {
    next(err);
  }
});

// --- Settings ---------------------------------------------------------------

router.get('/settings', async (req, res, next) => {
  try {
    const s = await money.getSettings();
    res.json({ settings: s });
  } catch (err) {
    next(err);
  }
});

// PUT /api/payouts/settings { commissionRate, deliveryCutRate, freeMonths }
// Rates are fractions: 0.15 is 15%. Only affects orders placed from now on.
router.put('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = [];

    const rate = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1;

    if (body.commissionRate !== undefined) {
      if (!rate(body.commissionRate)) {
        return res.status(400).json({ error: 'commissionRate must be between 0 and 1 (0.15 = 15%)' });
      }
      updates.push(['commission_rate', String(Number(body.commissionRate))]);
    }
    if (body.deliveryCutRate !== undefined) {
      if (!rate(body.deliveryCutRate)) {
        return res.status(400).json({ error: 'deliveryCutRate must be between 0 and 1' });
      }
      updates.push(['delivery_cut_rate', String(Number(body.deliveryCutRate))]);
    }
    if (body.freeMonths !== undefined) {
      const m = Number(body.freeMonths);
      if (!Number.isInteger(m) || m < 0 || m > 24) {
        return res.status(400).json({ error: 'freeMonths must be a whole number from 0 to 24' });
      }
      updates.push(['free_months', String(m)]);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value]
      );
    }
    res.json({ settings: await money.getSettings() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/payouts/bank/:type/:id - where to send someone's money.
router.put('/bank/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (type !== 'restaurant' && type !== 'driver') {
      return res.status(400).json({ error: 'type must be restaurant or driver' });
    }
    const { bankName, bankAccountName, bankAccountNumber } = req.body || {};
    const table = type === 'restaurant' ? 'restaurants' : 'drivers';
    const { rowCount } = await pool.query(
      `UPDATE ${table} SET bank_name = $1, bank_account_name = $2, bank_account_number = $3
       WHERE id = $4`,
      [bankName || null, bankAccountName || null, bankAccountNumber || null, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
