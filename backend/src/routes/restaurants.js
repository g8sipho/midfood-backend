const express = require('express');
const { pool } = require('../db');
const { imageUrl, thumbUrl } = require('./images');

const router = express.Router();

// A restaurant's star rating is the average of what customers gave its
// delivered orders. Until a few have rated it there is no rating to show, and
// the pages say "New" rather than inventing one.
const MIN_RATINGS = 3;

const LIST_COLUMNS = `r.id, r.name, r.cuisine, r.eta_minutes AS "etaMinutes", r.delivery_fee::float8 AS "deliveryFee",
                      r.hero_color AS "heroColor", r.open,
                      (SELECT i.id FROM images i WHERE i.restaurant_id = r.id) AS "imageId",
                      (SELECT COUNT(*)::int FROM orders o WHERE o.restaurant_id = r.id AND o.rating IS NOT NULL) AS "ratingCount",
                      (SELECT ROUND(AVG(o.rating)::numeric, 1)::float8 FROM orders o
                        WHERE o.restaurant_id = r.id AND o.rating IS NOT NULL) AS "ratingAverage"`;

function present(r) {
  const rated = r.ratingCount >= MIN_RATINGS;
  r.rating = rated ? r.ratingAverage : null;
  r.ratingCount = rated ? r.ratingCount : 0;
  delete r.ratingAverage;
  r.imageUrl = imageUrl(r.imageId);
  r.thumbUrl = thumbUrl(r.imageId);
  delete r.imageId;
  return r;
}

// GET /api/restaurants - list all restaurants (without full menu, for the home feed)
// GET /api/restaurants?q=cake - only those whose name, kind of food or menu
// matches, each with up to three of the dishes that matched.
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!q) {
      const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM restaurants r WHERE r.approved = true ORDER BY r.name`);
      return res.json({ restaurants: rows.map(present) });
    }
    // The customer's words are matched as plain text: % and _ mean themselves.
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS},
              ARRAY(SELECT m.name FROM menu_items m
                    WHERE m.restaurant_id = r.id AND m.available = true
                      AND (m.name ILIKE $1 OR m.category ILIKE $1)
                    ORDER BY m.name LIMIT 3) AS matches
       FROM restaurants r
       WHERE r.approved = true
         AND (r.name ILIKE $1 OR r.cuisine ILIKE $1 OR EXISTS (
               SELECT 1 FROM menu_items m
               WHERE m.restaurant_id = r.id AND m.available = true
                 AND (m.name ILIKE $1 OR m.category ILIKE $1 OR m.description ILIKE $1)))
       ORDER BY r.name`,
      [like]
    );
    res.json({ restaurants: rows.map(present) });
  } catch (err) {
    next(err);
  }
});

// GET /api/restaurants/:id - full detail including menu
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM restaurants r WHERE r.id = $1 AND r.approved = true`, [req.params.id]);
    const restaurant = rows[0];
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    present(restaurant);

    // Only items the restaurant hasn't marked sold out (see the portal at
    // /portal) show up to customers. Sorted into the menu's sections (in
    // alphabetical order), with unsorted dishes last.
    const menuResult = await pool.query(
      `SELECT m.id, m.name, m.description, m.price::float8 AS price, m.category,
              (SELECT i.id FROM images i WHERE i.menu_item_id = m.id) AS "imageId"
       FROM menu_items m
       WHERE m.restaurant_id = $1 AND m.available = true
       ORDER BY (m.category IS NULL), lower(m.category), m.name`,
      [restaurant.id]
    );
    restaurant.menu = menuResult.rows.map((m) => {
      m.imageUrl = imageUrl(m.imageId);
      m.thumbUrl = thumbUrl(m.imageId);
      delete m.imageId;
      return m;
    });

    res.json({ restaurant });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Restaurant not found' });
    next(err);
  }
});

module.exports = router;
