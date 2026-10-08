// Shared setup for the API tests: a throwaway database, a real server on a
// local port, and small helpers for the things every test does (sign up a
// customer, make a restaurant, pay for an order).
//
// The tests need a Postgres they are allowed to wipe. They refuse to run
// against any database whose name does not contain "test".
//
//   createdb midfood_test
//   TEST_DATABASE_URL=postgres://midfood:midfood@localhost:5432/midfood_test npm test
const crypto = require('crypto');

const DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://midfood:midfood@localhost:5432/midfood_test';
const dbName = new URL(DATABASE_URL).pathname.slice(1);
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests against "${dbName}": the database name must contain "test".`);
}

const PORT = process.env.TEST_PORT || '4123';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL,
  PGSSL: 'false',
  PORT,
  JWT_SECRET: 'test-secret',
  ADMIN_KEY: 'test-admin-key',
  PAYFAST_MODE: 'sandbox',
  PAYFAST_MERCHANT_ID: '10004002',
  PAYFAST_MERCHANT_KEY: 'q1cd2rdny4a53',
  PAYFAST_PASSPHRASE: 'payfast',
});

const BASE = `http://localhost:${PORT}`;
const ADMIN = { admin: 'test-admin-key' };

let server;
let pool;
let payfast;

// Wipes the database and starts the server. Call once, in a before() hook.
async function start() {
  const { Pool } = require('pg');
  const wipe = new Pool({ connectionString: DATABASE_URL });
  await wipe.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await wipe.end();

  payfast = require('../src/payments/payfast');
  // PayFast's servers are asked to confirm every payment notification. The
  // tests are not PayFast, so that one outbound call is answered locally.
  // Signature and amount checks still run for real.
  payfast.validateWithPayFast = async () => true;

  server = await require('../src/server').ready;
  pool = require('../src/db').pool;
  // The server seeds four demo restaurants into an empty database. The tests
  // want a clean slate they fully control.
  await pool.query('DELETE FROM restaurants');
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
}

// api('POST', '/api/orders', { token, body }) -> { status, data }
async function api(method, path, { token, admin, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (admin) headers['x-admin-key'] = admin;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

let counter = 0;
const unique = (prefix) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

async function customer(name = 'Thandi Customer') {
  const email = `${unique('c')}@example.com`;
  const r = await api('POST', '/api/auth/register', { body: { name, email, password: 'secret123' } });
  if (r.status !== 201) throw new Error(`customer signup failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.token, email, id: r.data.user.id };
}

// A live restaurant with a login and a small menu.
async function restaurant({ name = 'Test Kitchen', deliveryFee = 30, menu = [['Kota', 45], ['Chips', 25]] } = {}) {
  const username = unique('r');
  const made = await api('POST', '/api/admin/restaurants', {
    ...ADMIN,
    body: { name, cuisine: 'Test food', etaMinutes: 30, deliveryFee, heroColor: '#d97757', username, password: 'secret123' },
  });
  if (made.status !== 201) throw new Error(`restaurant create failed: ${JSON.stringify(made.data)}`);
  const login = await api('POST', '/api/restaurant-auth/login', { body: { username, password: 'secret123' } });
  const token = login.data.token;
  const items = [];
  for (const [itemName, price] of menu) {
    const r = await api('POST', '/api/portal/menu', { token, body: { name: itemName, description: 'Tasty', price } });
    items.push(r.data.item);
  }
  return { id: made.data.restaurant.id, username, token, items };
}

async function driver(name = 'Lucky Driver') {
  const username = unique('d');
  const made = await api('POST', '/api/admin/drivers', {
    ...ADMIN,
    body: { name, phone: '0820000000', username, password: 'secret123' },
  });
  if (made.status !== 201) throw new Error(`driver create failed: ${JSON.stringify(made.data)}`);
  const login = await api('POST', '/api/driver-auth/login', { body: { username, password: 'secret123' } });
  return { id: made.data.driver.id, username, token: login.data.token };
}

// Places an order for `lines` = [[menuItem, quantity], ...].
async function placeOrder(cust, resto, lines, extra = {}) {
  return api('POST', '/api/orders', {
    token: cust.token,
    body: {
      restaurantId: resto.id,
      items: lines.map(([item, quantity]) => ({ menuItemId: item.id, quantity })),
      deliveryAddress: '41 Turquoise St, Mineralia',
      customerPhone: '0821234567',
      ...extra,
    },
  });
}

// The notification PayFast sends when a payment completes, signed the way
// PayFast signs it. `overrides` lets a test send a wrong amount or signature.
async function notify(order, overrides = {}) {
  const fields = {
    m_payment_id: order.id,
    pf_payment_id: String(crypto.randomInt(1000000, 9999999)),
    payment_status: 'COMPLETE',
    item_name: 'MidFood order',
    amount_gross: Number(order.total).toFixed(2),
    amount_fee: '-5.00',
    amount_net: (Number(order.total) - 5).toFixed(2),
    merchant_id: '10004002',
    ...overrides,
  };
  if (!overrides.signature) fields.signature = payfast.buildSignature(fields, 'payfast');
  return api('POST', '/api/payments/payfast/notify', { form: fields });
}

async function paymentStatus(orderId) {
  const { rows } = await pool.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
  return rows[0] && rows[0].payment_status;
}

// Pays for an order and waits until the server has recorded it (the server
// answers PayFast first and does the work just after).
// Returns PayFast's payment id, so a test can replay the very same notification.
async function pay(order) {
  const pfPaymentId = String(crypto.randomInt(1000000, 9999999));
  await notify(order, { pf_payment_id: pfPaymentId });
  for (let i = 0; i < 100; i += 1) {
    if ((await paymentStatus(order.id)) === 'paid') {
      // The money split is written straight after the status flips.
      const { rows } = await pool.query('SELECT commission FROM orders WHERE id = $1', [order.id]);
      if (rows[0].commission !== null) return pfPaymentId;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('order was never marked paid');
}

// Swaps in a different answer from "PayFast's servers" for one test, and
// returns a function that puts the usual one back.
function payfastAnswers(fn) {
  const usual = payfast.validateWithPayFast;
  payfast.validateWithPayFast = fn;
  return () => { payfast.validateWithPayFast = usual; };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs one order all the way to the customer's door. Returns the order.
async function deliver(cust, resto, drv, lines, extra) {
  const placed = await placeOrder(cust, resto, lines, extra);
  const order = placed.data.order;
  await pay(order);
  await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
  await api('POST', `/api/portal/orders/${order.id}/preparing`, { token: resto.token });
  await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token });
  await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token });
  await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: drv.token });
  const done = await api('POST', `/api/driver/orders/${order.id}/deliver`, { token: drv.token });
  if (done.status !== 200) throw new Error(`delivery failed: ${JSON.stringify(done.data)}`);
  return order;
}

async function settings(values) {
  const r = await api('PUT', '/api/payouts/settings', { ...ADMIN, body: values });
  if (r.status !== 200) throw new Error(`settings failed: ${JSON.stringify(r.data)}`);
  return r.data.settings;
}

module.exports = {
  ADMIN, BASE, start, stop, api, customer, restaurant, driver, placeOrder, notify, pay, paymentStatus,
  deliver, settings, sleep, unique, payfastAnswers, db: () => pool,
};
