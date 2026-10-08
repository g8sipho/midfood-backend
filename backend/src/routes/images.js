// Pictures of dishes and restaurants.
//
// Reading is public (a menu is public). Writing is admin-only and lives in
// routes/admin.js; the helpers it needs are exported from here so the rules
// about what counts as an acceptable picture are in one place.
const express = require('express');
const { pool, uuid } = require('../db');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The admin page shrinks a photo before sending it, so anything bigger than
// this is not a menu photo that went through the page.
const MAX_BYTES = 600 * 1024;
// The small copy shown in lists: a square for a dish, a card-sized picture
// for a restaurant's cover.
const MAX_THUMB_BYTES = 120 * 1024;

// What the file actually is, judged by its first bytes rather than by what
// the sender says it is. Only real JPEG, PNG and WebP pictures are stored.
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Body parser for the upload routes: the raw bytes of one picture.
const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_BYTES });

// Checks an uploaded body. Returns { type } or { error }.
function checkUpload(req) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return { error: 'Send the picture itself as a JPEG, PNG or WebP file' };
  }
  const type = sniff(req.body);
  if (!type) return { error: 'That file is not a JPEG, PNG or WebP picture' };
  return { type };
}

// Replaces the picture belonging to one dish or one restaurant.
// `owner` is 'menu_item_id' or 'restaurant_id' (never anything from a request).
async function replaceImage(owner, ownerId, type, buf) {
  const table = owner === 'menu_item_id' ? 'menu_items' : 'restaurants';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One upload at a time per dish (or restaurant): a second one sent at the
    // same moment waits here, then replaces the first, instead of colliding.
    await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [ownerId]);
    await client.query(`DELETE FROM images WHERE ${owner} = $1`, [ownerId]);
    const id = uuid();
    await client.query(
      `INSERT INTO images (id, ${owner}, content_type, data, bytes) VALUES ($1, $2, $3, $4, $5)`,
      [id, ownerId, type, buf, buf.length]
    );
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Adds the small copy to the picture a dish already has. Returns the image
// id, or null if the dish has no picture to add it to.
async function setThumb(owner, ownerId, type, buf) {
  const { rows } = await pool.query(
    `UPDATE images SET thumb = $1, thumb_type = $2 WHERE ${owner} = $3 RETURNING id`,
    [buf, type, ownerId]
  );
  return rows[0] ? rows[0].id : null;
}

const imageUrl = (id) => (id ? `/api/images/${id}` : null);
const thumbUrl = (id) => (id ? `/api/images/${id}/thumb` : null);

// GET /api/images/:id/thumb - the small copy for lists. A picture that has
// no small copy (yet) answers with the full one, and says not to keep it, so
// the small one is picked up as soon as it exists.
router.get('/:id/thumb', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      'SELECT content_type, thumb_type, thumb, CASE WHEN thumb IS NULL THEN data END AS data FROM images WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const small = rows[0].thumb;
    res.setHeader('Content-Type', small ? rows[0].thumb_type : rows[0].content_type);
    res.setHeader('Cache-Control', small ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
    res.send(small || rows[0].data);
  } catch (err) {
    next(err);
  }
});

// GET /api/images/:id - the picture. Its content never changes for a given
// id, so it is served as cacheable for a year.
router.get('/:id', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query('SELECT content_type, data FROM images WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', rows[0].content_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    next(err);
  }
});

module.exports = { router, rawImage, checkUpload, replaceImage, setThumb, imageUrl, thumbUrl, MAX_BYTES, MAX_THUMB_BYTES, UUID };
