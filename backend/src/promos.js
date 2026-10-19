// Promo codes: whether a code applies to an order, and for how much.
//
// Used twice with the same answer: when the checkout page asks "is this code
// any good?" (POST /api/promos/check) and when the order is actually placed
// (POST /api/orders). The discount is worked out from the server's own
// prices, never from what the page sends, and it always comes off MidFood's
// side of the money - a kitchen is paid on the full food total and the driver
// on the full delivery fee whatever code the customer used.
const { pool } = require('./db');
const { share, money } = require('./money');

const CODE_RE = /^[A-Z0-9]{3,20}$/;

// "welcome 50" -> "WELCOME50". Returns null for anything that cannot be a code.
function normalizeCode(raw) {
  const code = String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

const PROMO_COLUMNS = `id, code, kind, value::float8 AS value, min_subtotal::float8 AS "minSubtotal",
  max_discount::float8 AS "maxDiscount", max_uses AS "maxUses", once_per_customer AS "oncePerCustomer",
  first_order_only AS "firstOrderOnly", restaurant_id AS "restaurantId", starts_at AS "startsAt",
  expires_at AS "expiresAt", active, note, created_at AS "createdAt"`;

// A one-line description for the customer: "R50 off", "10% off (up to R30)",
// "Free delivery".
function describe(promo) {
  if (promo.kind === 'free_delivery') return 'Free delivery';
  if (promo.kind === 'percent') {
    const pct = `${Number(promo.value) % 1 === 0 ? Number(promo.value) : promo.value}% off`;
    return promo.maxDiscount ? `${pct} (up to R${Number(promo.maxDiscount).toFixed(0)})` : pct;
  }
  return `R${Number(promo.value).toFixed(0)} off`;
}

// How many paid orders have used a code, and whether this customer has.
// Unpaid orders don't count: an abandoned checkout must not burn the code.
async function usage(code, userId, client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE user_id = $2)::int AS mine
     FROM orders WHERE promo_code = $1 AND payment_status = 'paid'`,
    [code, userId]
  );
  return rows[0];
}

// Decides whether `code` applies to an order of `subtotal` rands of food from
// `restaurantId` with a delivery fee of `deliveryFee`, for `userId`.
//   -> { ok: true, code, discount, description, promo }
//   -> { ok: false, reason }   (reason is written for the customer)
async function evaluate({ code: raw, userId, restaurantId, subtotal, deliveryFee }, client = pool) {
  const code = normalizeCode(raw);
  if (!code) return { ok: false, reason: "That doesn't look like a promo code." };

  const { rows } = await client.query(`SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE code = $1`, [code]);
  const promo = rows[0];
  const unknown = { ok: false, reason: 'That promo code is not valid.' };
  if (!promo || !promo.active) return unknown;

  const now = Date.now();
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now) return { ok: false, reason: 'That promo code is not active yet.' };
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < now) return { ok: false, reason: 'That promo code has expired.' };
  if (promo.restaurantId && promo.restaurantId !== restaurantId) {
    return { ok: false, reason: 'That promo code is for a different restaurant.' };
  }
  if (Number(subtotal) < promo.minSubtotal) {
    return { ok: false, reason: `That code needs at least R${promo.minSubtotal.toFixed(0)} of food in the order.` };
  }

  const used = await usage(code, userId, client);
  if (promo.maxUses != null && used.total >= promo.maxUses) return { ok: false, reason: 'That promo code has all been used up.' };
  if (promo.oncePerCustomer && used.mine > 0) return { ok: false, reason: "You've already used that promo code." };
  if (promo.firstOrderOnly) {
    const { rows: prior } = await client.query(
      `SELECT 1 FROM orders WHERE user_id = $1 AND payment_status = 'paid' LIMIT 1`,
      [userId]
    );
    if (prior.length) return { ok: false, reason: 'That promo code is for first orders only.' };
  }

  let discount = 0;
  if (promo.kind === 'free_delivery') discount = money(deliveryFee);
  else if (promo.kind === 'percent') {
    discount = share(subtotal, promo.value / 100);
    if (promo.maxDiscount != null) discount = Math.min(discount, promo.maxDiscount);
  } else discount = Math.min(money(promo.value), money(subtotal));
  discount = money(Math.max(0, discount));
  if (discount <= 0) return { ok: false, reason: "That code doesn't take anything off this order." };

  return { ok: true, code, discount, description: describe(promo), promo };
}

module.exports = { evaluate, normalizeCode, describe, PROMO_COLUMNS };
