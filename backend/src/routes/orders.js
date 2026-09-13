const express = require('express');
const { pool, uuid } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const STATUS_FLOW = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const ORDER_COLUMNS = `id, user_id AS "userId", restaurant_id AS "restaurantId", restaurant_name AS "restaurantName",
                       subtotal::float8 AS subtotal, delivery_fee::float8 AS "deliveryFee", total::float8 AS total,
                       delivery_address AS "deliveryAddress", status,
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

// POST /api/orders - place a new order.
// Body: { restaurantId, items: [{ menuItemId, quantity }], deliveryAddress }
// Prices are always looked up server-side from the restaurant's menu, never
// trusted from the client, so a tampered request can't change what's charged.
// The insert runs inside a transaction so an order is never left half-written
// (order row with no items, or vice versa) if something fails partway through.
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
      `INSERT INTO orders (id, user_id, restaurant_id, restaurant_name, subtotal, delivery_fee, total, delivery_address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'placed', $9, $9)`,
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
        createdAt: now,
        updatedAt: now,
      },
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
