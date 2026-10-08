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

// A percentage of an amount, to the cent. Worked in whole cents and whole
// hundredths-of-a-percent, because floating point gets exact halves wrong:
// 15% of R33.30 is R4.995, which should round to R5.00, but 33.3 * 0.15 in
// floating point is 4.99499..., which rounds to R4.99.
function share(amount, rate) {
  const cents = Math.round(Number(amount) * 100);
  const tenThousandths = Math.round(Number(rate) * 10000);
  return Math.round((cents * tenThousandths) / 10000) / 100;
}

// free_until for a restaurant joining today. The free period includes its
// last day, so "3 months free" starting on 8 October runs to 7 January, and
// zero free months means no free period at all (NULL), not a free day.
const FREE_UNTIL_SQL = `(
  SELECT CASE WHEN value::int > 0
    THEN ((now() AT TIME ZONE 'Africa/Johannesburg')::date + (value::int || ' months')::interval - interval '1 day')::date
    ELSE NULL END
  FROM settings WHERE key = 'free_months')`;

// A phone number as people here write it: digits, with optional spaces,
// dashes, brackets or a leading +. Anything else is not a phone number, and
// since these are shown to other people as tap-to-call links, it matters.
function isPhone(value) {
  const s = String(value == null ? '' : value).trim();
  return /^[+(]?[0-9][0-9 ()-]{5,18}[0-9]$/.test(s);
}

// The days a weekly payout can fall on.
const PAYOUT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    commissionRate: Number(s.commission_rate ?? 0.15),
    deliveryCutRate: Number(s.delivery_cut_rate ?? 0),
    freeMonths: Number(s.free_months ?? 3),
    payoutDay: PAYOUT_DAYS.includes(s.payout_day) ? s.payout_day : 'Tuesday',
  };
}

// Today's date in Middelburg, as YYYY-MM-DD. The server runs on UTC, and a
// free period that "ends on the 8th" has to mean the 8th here, not in London.
function saDate(when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(when);
}

// free_until as YYYY-MM-DD, whether Postgres handed back a Date or a string.
function dateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}

// A restaurant is free up to and including its free_until date.
function inFreePeriod(freeUntil, when = new Date()) {
  const until = dateString(freeUntil);
  return !!until && until >= saDate(when);
}

// The rate that applies to one restaurant right now: its own rate if it has
// one, otherwise the platform default — and zero while it is still inside its
// free period.
function rateFor(restaurant, settings, when = new Date()) {
  if (inFreePeriod(restaurant.freeUntil, when)) return 0;
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

  const commission = share(o.subtotal, rate);
  const restaurantPayout = money(o.subtotal - commission);
  const deliveryCut = share(o.deliveryFee, settings.deliveryCutRate);
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

module.exports = {
  money, share, getSettings, rateFor, recordSplit, restaurantOwing, driverOwing,
  inFreePeriod, dateString, saDate, PAYOUT_DAYS, FREE_UNTIL_SQL, isPhone,
};
