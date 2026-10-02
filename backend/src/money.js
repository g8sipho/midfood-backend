// How the money on an order splits, and who is owed what.
//
// The split is worked out once, when PayFast confirms payment, and frozen onto
// the order. Changing the commission rate later never rewrites an order that
// has already been placed, so a statement issued today still adds up in a
// year's time.
const { pool } = require('./db');

// Rounds to cents the way money should: half away from zero, so 0.125 -> 0.13.
// Plain toFixed() uses the float's binary value and quietly rounds 1.005 down.
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    commissionRate: Number(s.commission_rate ?? 0.15),
    deliveryCutRate: Number(s.delivery_cut_rate ?? 0),
    freeMonths: Number(s.free_months ?? 3),
  };
}

// The rate that applies to one restaurant right now: its own rate if it has
// one, otherwise the platform default — and zero while it is still inside its
// free period.
function rateFor(restaurant, settings, when = new Date()) {
  if (restaurant.freeUntil && new Date(restaurant.freeUntil) >= when) return 0;
  if (restaurant.commissionRate != null) return Number(restaurant.commissionRate);
  return settings.commissionRate;
}

// Writes the split onto an order. Called once, when payment is confirmed.
// Safe to call again: it only fills in an order whose split is still null, so
// a repeated PayFast notification can't change the numbers.
async function recordSplit(orderId, client = pool) {
  const { rows } = await client.query(
    `SELECT o.id, o.subtotal::float8 AS subtotal, o.delivery_fee::float8 AS "deliveryFee",
            o.commission, r.commission_rate AS "commissionRate", r.free_until AS "freeUntil"
     FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
     WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o) return null;
  if (o.commission != null) return null; // already settled — leave it alone

  const settings = await getSettings();
  const rate = rateFor(o, settings);

  const commission = money(o.subtotal * rate);
  const restaurantPayout = money(o.subtotal - commission);
  const deliveryCut = money(o.deliveryFee * settings.deliveryCutRate);
  const driverPayout = money(o.deliveryFee - deliveryCut);

  await client.query(
    `UPDATE orders
     SET commission = $1, commission_rate = $2, restaurant_payout = $3,
         driver_payout = $4, delivery_cut = $5
     WHERE id = $6 AND commission IS NULL`,
    [commission, rate, restaurantPayout, driverPayout, deliveryCut, orderId]
  );

  return { commission, rate, restaurantPayout, driverPayout, deliveryCut };
}

// What MidFood still owes a restaurant: delivered, paid, not yet paid out.
const RESTAURANT_OWING = `
  FROM orders o
  WHERE o.restaurant_id = $1 AND o.payment_status = 'paid' AND o.status = 'delivered'
    AND o.restaurant_payout_id IS NULL AND o.restaurant_payout IS NOT NULL`;

const DRIVER_OWING = `
  FROM orders o
  WHERE o.driver_id = $1 AND o.payment_status = 'paid' AND o.status = 'delivered'
    AND o.driver_payout_id IS NULL AND o.driver_payout IS NOT NULL`;

async function restaurantOwing(restaurantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS "orderCount",
            COALESCE(SUM(o.subtotal), 0)::float8 AS gross,
            COALESCE(SUM(o.commission), 0)::float8 AS deductions,
            COALESCE(SUM(o.restaurant_payout), 0)::float8 AS amount,
            MIN(o.updated_at) AS "oldest"
     ${RESTAURANT_OWING}`,
    [restaurantId]
  );
  return rows[0];
}

async function driverOwing(driverId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS "orderCount",
            COALESCE(SUM(o.delivery_fee), 0)::float8 AS gross,
            COALESCE(SUM(o.delivery_cut), 0)::float8 AS deductions,
            COALESCE(SUM(o.driver_payout), 0)::float8 AS amount,
            MIN(o.updated_at) AS "oldest"
     ${DRIVER_OWING}`,
    [driverId]
  );
  return rows[0];
}

module.exports = { money, getSettings, rateFor, recordSplit, restaurantOwing, driverOwing };
