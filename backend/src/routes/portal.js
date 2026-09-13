// Restaurant portal API: lets a logged-in restaurant manage its own menu.
// Every route here is scoped to req.restaurantId (set by requireRestaurantAuth),
// so a restaurant can only ever see or change its own items.
const express = require('express');
const { pool, uuid } = require('../db');
const { requireRestaurantAuth } = require('../middleware/auth');

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
              rating::float8 AS rating, hero_color AS "heroColor", username
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

module.exports = router;
