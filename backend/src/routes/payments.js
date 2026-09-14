// Payment provider webhooks and return pages. Deliberately NOT behind
// requireAuth: PayFast calls /payfast/notify server-to-server and has no
// customer JWT to send, and the return/cancel pages are loaded by the
// customer's browser mid-payment, before control is back in the app.
const express = require('express');
const { pool } = require('../db');
const payfast = require('../payments/payfast');

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

    const orderId = body.m_payment_id;
    const { rows } = await pool.query('SELECT id, total::float8 AS total FROM orders WHERE id = $1', [orderId]);
    const order = rows[0];
    if (!order) {
      console.error('PayFast ITN: unknown order', orderId);
      return;
    }

    const amountPaid = Number(body.amount_gross);
    if (!Number.isFinite(amountPaid) || Math.abs(amountPaid - order.total) > 0.05) {
      console.error('PayFast ITN: amount mismatch for order', orderId, '- got', amountPaid, 'expected', order.total);
      await pool.query('UPDATE orders SET payment_status = $1, payment_reference = $2 WHERE id = $3', [
        'failed',
        body.pf_payment_id || null,
        orderId,
      ]);
      return;
    }

    const newPaymentStatus = body.payment_status === 'COMPLETE' ? 'paid' : 'failed';
    await pool.query('UPDATE orders SET payment_status = $1, payment_reference = $2 WHERE id = $3', [
      newPaymentStatus,
      body.pf_payment_id || null,
      orderId,
    ]);
  } catch (err) {
    console.error('PayFast ITN handling error:', err);
  }
});

// Pages PayFast sends the customer's browser back to after payment. The app
// (see mobile CheckoutScreen) intercepts this redirect itself via
// expo-web-browser before it fully loads, but these need to exist as a valid
// destination regardless.
router.get('/payfast/return', (req, res) => {
  res.send(
    '<html><body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>Thanks!</h2><p>You can return to the MidFood app now.</p></body></html>'
  );
});
router.get('/payfast/cancel', (req, res) => {
  res.send(
    '<html><body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>Payment cancelled</h2><p>You can return to the MidFood app to try again.</p></body></html>'
  );
});

module.exports = router;
