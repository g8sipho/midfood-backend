// Paystack integration helpers (the backup to PayFast).
//
// Flow: when an order is placed, the backend asks Paystack to start a
// transaction (POST /transaction/initialize) and hands the customer the
// authorization_url it returns. Paystack then confirms the payment two ways:
//   - a webhook (POST /api/payments/paystack/webhook), signed with an
//     HMAC-SHA512 of the raw body using our secret key, and
//   - the customer's browser coming back to /api/payments/paystack/callback.
// Neither is trusted as-is: both look the transaction up again with
// GET /transaction/verify/:reference before an order is marked paid.
//
// Environment (Render): PAYSTACK_SECRET_KEY (sk_test_… while testing,
// sk_live_… once Paystack approves the business). Which gateway customers
// see is chosen with PAYMENT_PROVIDER=payfast|paystack.
const crypto = require('crypto');
const https = require('https');

const API_HOST = 'api.paystack.co';

function secretKey() {
  return process.env.PAYSTACK_SECRET_KEY || '';
}

function configured() {
  return Boolean(secretKey());
}

function isTestMode() {
  return secretKey().startsWith('sk_test_');
}

// Small JSON-over-HTTPS client. Swappable in tests via module.exports.http.
function defaultHttp({ method, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: API_HOST,
        path,
        method,
        headers: {
          Authorization: `Bearer ${secretKey()}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
          } catch (err) {
            reject(new Error(`Paystack sent back something that isn't JSON (HTTP ${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Paystack did not answer in time')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Each attempt to pay gets its own reference (Paystack refuses a reused one),
// but every reference starts with the order id so it can always be traced back.
function newReference(orderId) {
  return `${orderId}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

const ORDER_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[0-9a-z]+)?$/i;

function orderIdFromReference(reference) {
  const m = ORDER_ID_RE.exec(String(reference || ''));
  return m ? m[1].toLowerCase() : null;
}

// Returns the URL to send the customer to, or null if Paystack isn't set up.
async function startPayment({ order, buyer, callbackUrl }) {
  if (!configured()) return null;
  const email = (buyer && buyer.email) || '';
  if (!email) throw new Error('Paystack needs the customer’s email address');
  const { status, data } = await module.exports.http({
    method: 'POST',
    path: '/transaction/initialize',
    body: {
      email,
      amount: Math.round(Number(order.total) * 100), // cents
      currency: 'ZAR',
      reference: newReference(order.id),
      callback_url: callbackUrl,
      metadata: {
        order_id: order.id,
        restaurant: order.restaurantName,
        cancel_action: callbackUrl,
      },
    },
  });
  if (status !== 200 || !data || !data.status || !data.data || !data.data.authorization_url) {
    throw new Error(`Paystack would not start the payment: ${(data && data.message) || `HTTP ${status}`}`);
  }
  return data.data.authorization_url;
}

// Asks Paystack what really happened with a transaction. Resolves to
// { orderId, reference, success, amount (rands), currency } or null if
// Paystack couldn't be reached / doesn't know the reference.
async function verify(reference) {
  if (!configured() || !reference) return null;
  let res;
  try {
    res = await module.exports.http({
      method: 'GET',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
    });
  } catch (err) {
    console.error('Paystack verify failed:', err.message);
    return null;
  }
  const t = res && res.status === 200 && res.data && res.data.data;
  if (!t) return null;
  const orderId = (t.metadata && t.metadata.order_id) || orderIdFromReference(t.reference);
  return {
    orderId: orderId ? String(orderId).toLowerCase() : null,
    reference: String(t.reference),
    success: t.status === 'success',
    amount: Number(t.amount) / 100,
    currency: t.currency,
  };
}

// Paystack signs each webhook with HMAC-SHA512(rawBody, secret key).
function isWebhookSignatureValid(rawBody, signature) {
  if (!configured() || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  http: defaultHttp,
  configured,
  isTestMode,
  startPayment,
  verify,
  isWebhookSignatureValid,
  orderIdFromReference,
  newReference,
};
