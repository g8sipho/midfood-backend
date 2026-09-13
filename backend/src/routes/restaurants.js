const express = require('express');
const { pool } = require('../db');

const router = express.Router();

const LIST_COLUMNS = `id, name, cuisine, eta_minutes AS "etaMinutes", delivery_fee::float8 AS "deliveryFee",
                      rating::float8 AS rating, hero_color AS "heroColor"`;

// GET /api/restaurants - list all restaurants (without full menu, for the home feed)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM restaurants ORDER BY name`);
    res.json({ restaurants: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/restaurants/:id - full detail including menu
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM restaurants WHERE id = $1`, [req.params.id]);
    const restaurant = rows[0];
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const menuResult = await pool.query(
      'SELECT id, name, description, price::float8 AS price FROM menu_items WHERE restaurant_id = $1 ORDER BY name',
      [restaurant.id]
    );
    restaurant.menu = menuResult.rows;

    res.json({ restaurant });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
