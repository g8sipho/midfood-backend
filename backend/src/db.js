// Postgres-backed database layer.
//
// This replaces the original lowdb/JSON file store (see the root README's
// "Before you launch" section, which called this migration out explicitly).
// Connects via DATABASE_URL, the standard env var on Render, Railway, and
// Fly.io alike. For local development, docker-compose.yml in this folder
// gives you a matching Postgres instance — see the README for how to run it.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { v4: uuid } = require('uuid');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env, start Postgres (see README), and set DATABASE_URL.'
  );
}

// Hosted Postgres (e.g. Render's managed database) requires SSL; a local
// docker-compose instance does not. Toggle with PGSSL in .env.
const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Runs every .sql file in migrations/, in filename order (001_..., 002_...,
// etc.), so adding a new migration is just adding a new numbered file here.
// Each file is written to be safe to re-run (CREATE TABLE IF NOT EXISTS,
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS, etc.), so this runs on every
// server startup against an already-migrated database too.
async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
  }
}

// Same four restaurants as the original seed data, so the mobile app (which
// still expects this catalog) keeps working unchanged.
const SEED_RESTAURANTS = [
  {
    id: uuid(),
    name: 'Braai House Rosebank',
    cuisine: 'South African · Grills',
    etaMinutes: 35,
    deliveryFee: 25,
    rating: 4.7,
    heroColor: '#d97757',
    menu: [
      { id: uuid(), name: 'Boerewors Roll', description: 'Grilled boerewors, fried onions, tomato relish', price: 65 },
      { id: uuid(), name: 'Chicken Sosatie Plate', description: 'Marinated chicken skewers, pap, chakalaka', price: 110 },
      { id: uuid(), name: 'Braai Platter for 2', description: 'Mixed grill, garlic bread, side salad', price: 220 },
    ],
  },
  {
    id: uuid(),
    name: "Mama Thandi's Kitchen",
    cuisine: 'Home-style · Comfort food',
    etaMinutes: 40,
    deliveryFee: 20,
    rating: 4.9,
    heroColor: '#558a42',
    menu: [
      { id: uuid(), name: 'Bunny Chow (Mutton)', description: 'Hollowed bread loaf filled with mutton curry', price: 95 },
      { id: uuid(), name: 'Umngqusho Bowl', description: 'Samp and beans with slow-cooked beef', price: 85 },
      { id: uuid(), name: 'Malva Pudding', description: 'Warm, with custard', price: 45 },
    ],
  },
  {
    id: uuid(),
    name: 'Sushi Yama',
    cuisine: 'Japanese · Sushi',
    etaMinutes: 30,
    deliveryFee: 30,
    rating: 4.6,
    heroColor: '#2a78d6',
    menu: [
      { id: uuid(), name: 'California Roll (8pc)', description: 'Crab, avocado, cucumber', price: 89 },
      { id: uuid(), name: 'Salmon Nigiri Set', description: '6 pieces fresh salmon nigiri', price: 120 },
      { id: uuid(), name: 'Chicken Katsu Bento', description: 'Crumbed chicken, rice, salad, miso soup', price: 135 },
    ],
  },
  {
    id: uuid(),
    name: 'Pizza Nonna',
    cuisine: 'Italian · Pizza',
    etaMinutes: 25,
    deliveryFee: 22,
    rating: 4.5,
    heroColor: '#c9a82d',
    menu: [
      { id: uuid(), name: 'Margherita', description: 'Tomato, mozzarella, fresh basil', price: 95 },
      { id: uuid(), name: 'Pepperoni Feast', description: 'Double pepperoni, mozzarella', price: 125 },
      { id: uuid(), name: 'Garlic Rolls (6)', description: 'Baked fresh, garlic butter', price: 40 },
    ],
  },
];

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM restaurants');
  if (rows[0].count > 0) return;

  for (const restaurant of SEED_RESTAURANTS) {
    await pool.query(
      `INSERT INTO restaurants (id, name, cuisine, eta_minutes, delivery_fee, rating, hero_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        restaurant.id,
        restaurant.name,
        restaurant.cuisine,
        restaurant.etaMinutes,
        restaurant.deliveryFee,
        restaurant.rating,
        restaurant.heroColor,
      ]
    );
    for (const item of restaurant.menu) {
      await pool.query(
        `INSERT INTO menu_items (id, restaurant_id, name, description, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.id, restaurant.id, item.name, item.description, item.price]
      );
    }
  }
}

async function init() {
  await runMigrations();
  await seedIfEmpty();
}

module.exports = { pool, init, uuid };
