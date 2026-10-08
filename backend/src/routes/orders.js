const express = require('express');
const { pool, uuid } = require('../db');
const { requireAuth } = require('../middleware/auth');
const payfast = require('../payments/payfast');

const router = express.Router();

// Real status flow, now driven by the restaurant portal and the driver app
// rather than the old development-only "advance" button.
const STATUS_FLOW = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const ORDER_COLUMNS = `id, user_id AS "userId", restaurant_id AS "restaurantId", restaurant_name AS "restaurantName",
                       subtotal::float8 AS subtotal, delivery_fee::float8 AS "deliveryFee", total::float8 AS total,
                       delivery_address AS "deliveryAddress",
                       delivery_lat AS "deliveryLat", delivery_lng AS "deliveryLng", status,
                       payment_status AS "paymentStatus", payment_reference AS "paymentReference",
                       ready_at AS "readyAt", driver_id AS "driverId", notes,
                       rejected_reason AS "rejectedReason", refunded_at AS "refundedAt", rating,
                       created_at AS "createdAt", updated_at AS "updatedAt"`;

// All order routes require a logged-in user.
router.use(requireAuth);

async function attachItems(order) {
  const { rows } = await pool.query(
    'SELECT menu_item_id AS "menuItemId", name, price::float8 AS price, quantity FROM order_items WHERE order_id = $1',
    [order.id]
  );
  order.items = rows;
  return order;
}

// Builds the three URLs PayFast needs, based on wherever this backend is
// actually reachable at (works the same on Render as on localhost).
function paymentUrlsFor(req, orderId) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    returnUrl: `${base}/api/payments/payfast/return?order=${orderId}`,
    cancelUrl: `${base}/api/payments/payfast/cancel?order=${orderId}`,
    notifyUrl: `${base}/api/payments/payfast/notify`,
  };
}

// Middelburg town centre. A delivery pin further than this from it is not a
// real delivery: the customer's phone has reported nonsense (a VPN, a stale
// fix), and sending a driver to it would be worse than having no pin at all.
const TOWN = { lat: -25.7751, lng: 29.4648 };
const MAX_PIN_KM = 60;

function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The customer's optional GPS pin. Returns { lat, lng } or null. A pin is
// only ever a help to the driver, so a bad one is dropped, never an error.
function cleanPin(lat, lng) {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const pin = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null;
  if (Math.abs(pin.lat) > 90 || Math.abs(pin.lng) > 180) return null;
  if (kmBetween(TOWN, pin) > MAX_PIN_KM) return null;
  return pin;
}

// POST /api/orders - place a new order.
// Body: { restaurantId, items: [{ menuItemId, quantity }], deliveryAddress,
//         customerPhone?, notes?, deliveryLat?, deliveryLng? }
// Prices are always looked up server-side from the restaurant's menu, never
// trusted from the client, so a tampered request can't change what's charged.
// The insert runs inside a transaction so an order is never left half-written
// (order row with no items, or vice versa) if something fails partway through.
//
// The order itself is created right away with payment_status 'pending' --
// nothing is lost if the customer abandons payment -- and the response
// includes a `paymentUrl` to redirect them to next. See src/payments/payfast.js
// and src/routes/payments.js for how payment is actually confirmed.
router.post('/', async (req, res, next) => {
  const { restaurantId, items, deliveryAddress, customerPhone, notes, deliveryLat, deliveryLng, expectedTotal } =
    req.body || {};
  const pin = cleanPin(deliveryLat, deliveryLng);

  if (!restaurantId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'restaurantId and a non-empty items array are required' });
  }
  if (!deliveryAddress || !String(deliveryAddress).trim()) {
    return res.status(400).json({ error: 'deliveryAddress is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const restaurantResult = await client.query(
      'SELECT id, name, delivery_fee::float8 AS "deliveryFee", open, approved FROM restaurants WHERE id = $1',
      [restaurantId]
    );
    const restaurant = restaurantResult.rows[0];
    if (!restaurant || !restaurant.approved) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    if (!restaurant.open) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `${restaurant.name} is closed right now. Please try again later.` });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const requested of items) {
      const menuResult = await client.query(
        'SELECT id, name, price::float8 AS price, available FROM menu_items WHERE id = $1 AND restaurant_id = $2',
        [requested.menuItemId, restaurantId]
      );
      const menuItem = menuResult.rows[0];
      if (!menuItem) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Menu item ${requested.menuItemId} not found for this restaurant` });
      }
      // The kitchen may have marked it sold out since this customer opened the
      // menu. Better to say so now than to take money for food that is gone.
      if (!menuItem.available) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Sorry, ${menuItem.name} has just sold out.`,
          soldOutItemId: menuItem.id,
        });
      }
      const quantity = Number(requested.quantity) > 0 ? Math.floor(Number(requested.quantity)) : 1;
      subtotal += menuItem.price * quantity;
      orderItems.push({ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity });
    }

    const deliveryFee = restaurant.deliveryFee;
    const total = subtotal + deliveryFee;

    // The ordering page sends the total it showed the customer. If a price or
    // the delivery fee has changed since they opened the menu, they are asked
    // to look again rather than being charged a figure they never saw.
    if (expectedTotal !== undefined && expectedTotal !== null
        && Math.abs(Number(expectedTotal) - total) > 0.005) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Prices have changed since you opened the menu. Please check your order and the new total.',
        priceChanged: true,
        total,
      });
    }
    const orderId = uuid();
    const now = new Date().toISOString();
    const trimmedAddress = String(deliveryAddress).trim();

    await client.query(
      `INSERT INTO orders (id, user_id, restaurant_id, restaurant_name, subtotal, delivery_fee, total, delivery_address, status, payment_status, customer_phone, notes, created_at, updated_at, delivery_lat, delivery_lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'placed', 'pending', $9, $10, $11, $11, $12, $13)`,
      [orderId, req.userId, restaurant.id, restaurant.name, subtotal, deliveryFee, total, trimmedAddress,
       customerPhone ? String(customerPhone).trim() : null, notes ? String(notes).trim() : null, now,
       pin ? pin.lat : null, pin ? pin.lng : null]
    );

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (id, order_id, menu_item_id, name, price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuid(), orderId, item.menuItemId, item.name, item.price, item.quantity]
      );
    }

    await client.query('COMMIT');

    const buyerResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.userId]);
    const buyer = buyerResult.rows[0];

    const { returnUrl, cancelUrl, notifyUrl } = paymentUrlsFor(req, orderId);
    const paymentUrl = payfast.buildPaymentUrl({
      order: { id: orderId, total, restaurantName: restaurant.name },
      buyer,
      returnUrl,
      cancelUrl,
      notifyUrl,
    });

    res.status(201).json({
      order: {
        id: orderId,
        userId: req.userId,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        items: orderItems,
        subtotal,
        deliveryFee,
        total,
        deliveryAddress: trimmedAddress,
        deliveryLat: pin ? pin.lat : null,
        deliveryLng: pin ? pin.lng : null,
        status: 'placed',
        paymentStatus: 'pending',
        paymentReference: null,
        createdAt: now,
        updatedAt: now,
      },
      paymentUrl,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/orders - the logged-in user's order history, newest first.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId]
    );
    const orders = await Promise.all(rows.map(attachItems));
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id - a single order, only if it belongs to the caller.
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.userId,
    ]);
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    await attachItems(order);
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/payfast-checkout - get a fresh payment link for an
// order that hasn't been paid yet (e.g. the customer backed out of payment
// the first time, or it failed and they want to retry).
router.post('/:id/payfast-checkout', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, total::float8 AS total, restaurant_name AS "restaurantName", payment_status AS "paymentStatus"
       FROM orders WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'This order is already paid' });
    }

    const buyerResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.userId]);
    const buyer = buyerResult.rows[0];

    const { returnUrl, cancelUrl, notifyUrl } = paymentUrlsFor(req, order.id);
    const paymentUrl = payfast.buildPaymentUrl({ order, buyer, returnUrl, cancelUrl, notifyUrl });
    if (!paymentUrl) {
      return res.status(500).json({ error: 'Payments are not configured on the server yet' });
    }
    res.json({ paymentUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/rating { rating: 1..5 } - the customer's stars for a
// delivered order. One rating per order, by the person who ordered it; it can
// be changed, and the restaurant's rating is the average of all of them.
router.post('/:id/rating', async (req, res, next) => {
  try {
    const stars = req.body && req.body.rating;
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'rating must be a whole number from 1 to 5' });
    }
    const { rows } = await pool.query(
      `UPDATE orders SET rating = $1, rated_at = now()
       WHERE id = $2 AND user_id = $3 AND status = 'delivered' AND payment_status = 'paid'
       RETURNING id, rating`,
      [stars, req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Only an order that has been delivered to you can be rated' });
    res.json({ ok: true, rating: rows[0].rating });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Order not found' });
    next(err);
  }
});

// GET /api/orders/:id/tracking - live status plus the driver's last known
// position, so the customer can watch the driver approach.
router.get('/:id/tracking', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.status, o.payment_status AS "paymentStatus", o.ready_at AS "readyAt",
              o.restaurant_name AS "restaurantName", o.delivery_address AS "deliveryAddress",
              o.delivery_lat AS "deliveryLat", o.delivery_lng AS "deliveryLng",
              o.rejected_reason AS "rejectedReason", o.refunded_at AS "refundedAt", o.rating,
              o.updated_at AS "updatedAt",
              d.name AS "driverName", d.phone AS "driverPhone",
              d.lat AS "driverLat", d.lng AS "driverLng", d.location_updated_at AS "driverSeenAt"
       FROM orders o LEFT JOIN drivers d ON d.id = o.driver_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const tracking = rows[0];
    // The driver's whereabouts and number are the customer's business only
    // while that driver is bringing them food.
    if (tracking.status === 'delivered' || tracking.status === 'rejected') {
      tracking.driverLat = null;
      tracking.driverLng = null;
      tracking.driverSeenAt = null;
      tracking.driverPhone = null;
    }
    res.json({ tracking });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
