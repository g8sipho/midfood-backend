const express = require('express');
const { pool, uuid } = require('../db');
const { requireAuth } = require('../middleware/auth');
const payfast = require('../payments/payfast');

const router = express.Router();

const STATUS_FLOW = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const ORDER_COLUMNS = `id, user_id AS "userId", restaurant_id AS "restaurantId", restaurant_name AS "restaurantName",
                       subtotal::float8 AS subtotal, delivery_fee::float8 AS "deliveryFee", total::float8 AS total,
                       delivery_address AS "deliveryAddress", status,
                       payment_status AS "paymentStatus", payment_reference AS "paymentReference",
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

// POST /api/orders - place a new order.
// Body: { restaurantId, items: [{ menuItemId, quantity }], deliveryAddress }
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
  const { restaurantId, items, deliveryAddress } = req.body || {};

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
      'SELECT id, name, delivery_fee::float8 AS "deliveryFee" FROM restaurants WHERE id = $1',
      [restaurantId]
    );
    const restaurant = restaurantResult.rows[0];
    if (!restaurant) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const requested of items) {
      const menuResult = await client.query(
        'SELECT id, name, price::float8 AS price FROM menu_items WHERE id = $1 AND restaurant_id = $2',
        [requested.menuItemId, restaurantId]
      );
      const menuItem = menuResult.rows[0];
      if (!menuItem) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Menu item ${requested.menuItemId} not found for this restaurant` });
      }
      const quantity = Number(requested.quantity) > 0 ? Math.floor(Number(requested.quantity)) : 1;
      subtotal += menuItem.price * quantity;
      orderItems.push({ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity });
    }

    const deliveryFee = restaurant.deliveryFee;
    const total = subtotal + deliveryFee;
    const orderId = uuid();
    const now = new Date().toISOString();
    const trimmedAddress = String(deliveryAddress).trim();

    await client.query(
      `INSERT INTO orders (id, user_id, restaurant_id, restaurant_name, subtotal, delivery_fee, total, delivery_address, status, payment_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'placed', 'pending', $9, $9)`,
      [orderId, req.userId, restaurant.id, restaurant.name, subtotal, deliveryFee, total, trimmedAddress, now]
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

// PATCH /api/orders/:id/advance - move the order to the next status.
// Stands in for real courier/restaurant status updates so the tracking
// screen has something real to poll during development. Replace with
// webhook-driven updates from your delivery/restaurant partners later.
router.patch('/:id/advance', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, status FROM orders WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.userId,
    ]);
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentIndex = STATUS_FLOW.indexOf(order.status);
    const nextStatus = STATUS_FLOW[currentIndex + 1];
    if (!nextStatus) {
      return res.status(400).json({ error: `Order is already ${order.status}` });
    }

    const now = new Date().toISOString();
    await pool.query('UPDATE orders SET status = $1, updated_at = $2 WHERE id = $3', [nextStatus, now, order.id]);

    const updatedResult = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [order.id]);
    const updated = updatedResult.rows[0];
    await attachItems(updated);
    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
