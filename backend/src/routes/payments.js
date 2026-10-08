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
    const authentic = await payfast.validateWithPayFast(req.rawBody);
    if (!authentic) {
      console.error('PayFast ITN: failed PayFast server-side validation for order', body.m_payment_id);
      return;
    }

    // A notification meant for a different PayFast account is not ours to act on.
    const ourMerchantId = process.env.PAYFAST_MERCHANT_ID;
    if (body.merchant_id && ourMerchantId && String(body.merchant_id) !== String(ourMerchantId)) {
      console.error('PayFast ITN: wrong merchant_id for order', body.m_payment_id);
      return;
    }

    const orderId = body.m_payment_id;
    if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) {
      console.error('PayFast ITN: not a MidFood order id:', orderId);
      return;
    }
    const { rows } = await pool.query('SELECT id, total::float8 AS total FROM orders WHERE id = $1', [orderId]);
    const order = rows[0];
    if (!order) {
      console.error('PayFast ITN: unknown order', orderId);
      return;
    }

    // Once an order is paid it stays paid: a late or repeated notification
    // must never un-pay an order the kitchen may already be cooking. Hence
    // "AND payment_status <> 'paid'" on both failure paths below.
    const amountPaid = Number(body.amount_gross);
    if (!Number.isFinite(amountPaid) || Math.abs(amountPaid - order.total) > 0.05) {
      console.error('PayFast ITN: amount mismatch for order', orderId, '- got', amountPaid, 'expected', order.total);
      await pool.query(
        `UPDATE orders SET payment_status = 'failed', payment_reference = $1
         WHERE id = $2 AND payment_status <> 'paid'`,
        [body.pf_payment_id || null, orderId]
      );
      return;
    }

    const newPaymentStatus = body.payment_status === 'COMPLETE' ? 'paid' : 'failed';
    if (newPaymentStatus === 'paid') {
      await pool.query('UPDATE orders SET payment_status = $1, payment_reference = $2 WHERE id = $3', [
        'paid',
        body.pf_payment_id || null,
        orderId,
      ]);
    } else {
      await pool.query(
        `UPDATE orders SET payment_status = 'failed', payment_reference = $1
         WHERE id = $2 AND payment_status <> 'paid'`,
        [body.pf_payment_id || null, orderId]
      );
    }

    // Freeze how this order's money splits, now that it is actually paid for.
    // Doing it here rather than at payout time means a later rate change never
    // rewrites an order that has already happened.
    if (newPaymentStatus === 'paid') {
      await money.recordSplit(orderId);
    }
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
