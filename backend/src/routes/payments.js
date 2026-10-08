// Payment provider webhooks and return pages. Deliberately NOT behind
// requireAuth: PayFast calls /payfast/notify server-to-server and has no
// customer JWT to send, and the return/cancel pages are loaded by the
// customer's browser mid-payment, before control is back in the app.
const express = require('express');
const { pool } = require('../db');
const payfast = require('../payments/payfast');
const money = require('../money');

const router = express.Router();

// PayFast POSTs application/x-www-form-urlencoded, not JSON. `verify`
// captures the exact raw bytes too, since the authenticity check with
// PayFast's own servers must resend precisely what we received.
const urlencodedCapturingRaw = express.urlencoded({
  extended: false,
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

// PayFast's own confirmation that a notification is genuine. If PayFast cannot
// be reached, that says nothing about the payment, so it is asked again a few
// times before giving up. Without this, one network blip would leave a
// customer charged and their order stuck on "waiting for payment".
const VALIDATE_ATTEMPTS = 4;
const VALIDATE_WAIT_MS = process.env.NODE_ENV === 'test' ? 10 : 3000;

async function confirmedByPayFast(rawBody) {
  for (let attempt = 1; attempt <= VALIDATE_ATTEMPTS; attempt += 1) {
    const answer = await payfast.validateWithPayFast(rawBody);
    if (answer === true || answer === false) return answer;
    if (attempt < VALIDATE_ATTEMPTS) await new Promise((r) => setTimeout(r, VALIDATE_WAIT_MS * attempt));
  }
  return null;
}

// POST /api/payments/payfast/notify - PayFast's server-to-server payment
// confirmation (the "ITN"). Always acknowledges with 200 immediately so
// PayFast doesn't retry forever; the actual verification happens after, and
// any failure is only logged -- the order is simply left unpaid.
router.post('/payfast/notify', urlencodedCapturingRaw, async (req, res) => {
  res.status(200).end();

  try {
    const body = req.body || {};

    if (!payfast.isSignatureValid(body)) {
      console.error('PayFast ITN: signature mismatch for order', body.m_payment_id);
      return;
    }
    const authentic = await confirmedByPayFast(req.rawBody);
    if (authentic !== true) {
      console.error(
        authentic === null
          ? 'PayFast ITN: PayFast could not be reached to confirm the payment for order'
          : 'PayFast ITN: failed PayFast server-side validation for order',
        body.m_payment_id,
        '- pf_payment_id',
        body.pf_payment_id
      );
      return;
    }

    // A notification meant for a different PayFast account is not ours to act on.
    const ourMerchantId = process.env.PAYFAST_MERCHANT_ID;
    if (body.merchant_id && ourMerchantId && String(body.merchant_id) !== String(ourMerchantId)) {
      console.error('PayFast ITN: wrong merchant_id for order', body.m_payment_id);
      return;
    }

    const orderId = body.m_payment_id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderId || ''))) {
      console.error('PayFast ITN: not a MidFood order id:', orderId);
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, total::float8 AS total, payment_status AS "paymentStatus", payment_reference AS "paymentReference"
       FROM orders WHERE id = $1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) {
      console.error('PayFast ITN: unknown order', orderId);
      return;
    }

    const pfPaymentId = body.pf_payment_id ? String(body.pf_payment_id) : null;
    const complete = body.payment_status === 'COMPLETE';
    const amountPaid = Number(body.amount_gross);

    // A second, different payment for an order that is already paid: the
    // customer has been charged twice. The order itself is left exactly as it
    // is, and the extra payment is recorded as money to send back.
    if (complete && order.paymentStatus === 'paid' && pfPaymentId && order.paymentReference
        && pfPaymentId !== order.paymentReference) {
      await pool.query(
        `INSERT INTO extra_payments (pf_payment_id, order_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (pf_payment_id) DO NOTHING`,
        [pfPaymentId, orderId, Number.isFinite(amountPaid) ? amountPaid : order.total]
      );
      console.error('PayFast ITN: order', orderId, 'was paid a second time - pf_payment_id', pfPaymentId);
      return;
    }

    // Once an order is paid it stays paid: a late or repeated notification
    // must never un-pay an order the kitchen may already be cooking. Hence
    // "AND payment_status <> 'paid'" on both failure paths below.
    if (!Number.isFinite(amountPaid) || Math.abs(amountPaid - order.total) > 0.05) {
      console.error('PayFast ITN: amount mismatch for order', orderId, '- got', amountPaid, 'expected', order.total);
      await pool.query(
        `UPDATE orders SET payment_status = 'failed', payment_reference = $1
         WHERE id = $2 AND payment_status <> 'paid'`,
        [pfPaymentId, orderId]
      );
      return;
    }

    if (!complete) {
      await pool.query(
        `UPDATE orders SET payment_status = 'failed', payment_reference = $1
         WHERE id = $2 AND payment_status <> 'paid'`,
        [pfPaymentId, orderId]
      );
      return;
    }

    // paid_at is written once, the first time, and never moved by a repeat.
    await pool.query(
      `UPDATE orders SET payment_status = 'paid', payment_reference = COALESCE($1, payment_reference),
              paid_at = COALESCE(paid_at, now())
       WHERE id = $2`,
      [pfPaymentId, orderId]
    );

    // Freeze how this order's money splits, now that it is actually paid for.
    // Doing it here rather than at payout time means a later rate change never
    // rewrites an order that has already happened.
    await money.recordSplit(orderId);
  } catch (err) {
    console.error('PayFast ITN handling error:', err);
  }
});

// Pages PayFast sends the customer's browser back to after payment. The app
// (see mobile CheckoutScreen) intercepts this redirect itself via
// expo-web-browser before it fully loads, but these need to exist as a valid
// destination regardless.
// `order` is the id PayFast echoes back from the checkout link we built.
// Anything else is ignored, so this can't be used to bounce a visitor
// somewhere unexpected.
function backToOrder(req, res) {
  const id = String(req.query.order || '');
  if (/^[0-9a-f-]{36}$/i.test(id)) return res.redirect(`/order/#order/${id}`);
  return res.redirect('/order/#orders');
}

router.get('/payfast/return', backToOrder);
router.get('/payfast/cancel', backToOrder);

module.exports = router;
