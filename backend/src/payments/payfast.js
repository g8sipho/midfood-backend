// PayFast (South African payment gateway) integration helpers.
//
// Handles building the "onsite payment" redirect URL a customer is sent to
// after placing an order, and verifying the server-to-server ITN (Instant
// Transaction Notification) PayFast sends once payment completes.
//
// PayFast's signature scheme has been stable for years: concatenate every
// non-empty field as urlencoded name=value pairs (PHP-style encoding, with
// spaces as '+'), in a fixed order, append the merchant's passphrase if one
// is set, then MD5 the result. The same recipe is used both when building
// the outgoing payment URL and when verifying an incoming ITN.
//
// Which PayFast this talks to is decided by four environment variables set in
// Render's Environment tab: PAYFAST_MODE ("live" or "sandbox") and the
// merchant account's PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY /
// PAYFAST_PASSPHRASE. The passphrase must be exactly the one saved in the
// PayFast dashboard, or every payment is refused with a signature error.
const crypto = require('crypto');
const https = require('https');

const MODE = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
const IS_SANDBOX = MODE !== 'live';

const HOST = IS_SANDBOX ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
const PROCESS_URL = `https://${HOST}/eng/process`;
const VALIDATE_HOST = HOST;
const VALIDATE_PATH = '/eng/query/validate';

// PayFast expects PHP's urlencode() convention (spaces as '+'), which is
// close to but not identical to JS's encodeURIComponent.
function pfEncode(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, '+');
}

function buildSignature(fields, passphrase) {
  const parts = Object.entries(fields)
    .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${pfEncode(value)}`);
  if (passphrase) {
    parts.push(`passphrase=${pfEncode(passphrase)}`);
  }
  return crypto.createHash('md5').update(parts.join('&')).digest('hex');
}

// Builds the URL to send the customer's browser to for payment. Returns null
// if PayFast isn't configured, so callers can fail gracefully.
function buildPaymentUrl({ order, buyer, returnUrl, cancelUrl, notifyUrl }) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) return null;

  const fields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    name_first: (buyer && buyer.name) || '',
    email_address: (buyer && buyer.email) || '',
    m_payment_id: order.id,
    amount: Number(order.total).toFixed(2),
    item_name: `MidFood order — ${order.restaurantName}`.slice(0, 255),
  };

  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const signature = buildSignature(fields, passphrase);

  const query = Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${pfEncode(value)}`)
    .concat(`signature=${signature}`)
    .join('&');

  return `${PROCESS_URL}?${query}`;
}

// Recomputes the ITN's signature from the parsed POST body and compares.
function isSignatureValid(body) {
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const expected = buildSignature(body, passphrase);
  return expected === body.signature;
}

// Confirms with PayFast's own servers that an ITN really came from them --
// protects against a spoofed POST to /notify. Sends the exact raw bytes we
// received (not a re-serialized copy) since re-encoding could subtly differ.
// Resolves true (PayFast confirms it), false (PayFast says it is not theirs),
// or null (PayFast could not be reached, so nothing is known yet).
function validateWithPayFast(rawBody) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: VALIDATE_HOST,
        path: VALIDATE_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(rawBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 500) return resolve(null);
          resolve(data.trim() === 'VALID');
        });
      }
    );
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.write(rawBody);
    req.end();
  });
}

module.exports = { buildPaymentUrl, buildSignature, isSignatureValid, validateWithPayFast, IS_SANDBOX };
