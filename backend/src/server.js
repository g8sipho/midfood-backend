require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const db = require('./db');
const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const orderRoutes = require('./routes/orders');
const restaurantAuthRoutes = require('./routes/restaurantAuth');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Restaurant portal (menu management) and the admin page used to create
// restaurant accounts -- static HTML/JS, served straight from this same
// service so there's nothing extra to host or pay for.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'midfood-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/restaurant-auth', restaurantAuthRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/admin', adminRoutes);

// Fallback 404 for anything unmatched under /api
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Run migrations + seed data before accepting traffic, so a fresh Postgres
// (a brand-new Render/Railway/Fly database, or a first `docker compose up`
// locally) is ready on the very first request instead of erroring.
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MidFood backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize the database:', err);
    process.exit(1);
  });
