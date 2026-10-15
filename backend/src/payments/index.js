// Which payment gateway customers are sent to. PAYMENT_PROVIDER=paystack
// switches every new payment link to Paystack; anything else (or unset)
// keeps PayFast. Confirmations from both keep working whatever the setting,
// so orders already in flight when the switch is flipped still get paid.
const payfast = require('./payfast');
const paystack = require('./paystack');

function provider() {
  return (process.env.PAYMENT_PROVIDER || 'payfast').toLowerCase() === 'paystack' ? 'paystack' : 'payfast';
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Resolves to the URL to send the customer to, or null when the chosen
// gateway isn't configured on the server. `order` needs id, total and
// restaurantName; `buyer` needs name and email.
async function paymentLinkFor(req, order, buyer) {
  const base = baseUrl(req);
  if (provider() === 'paystack') {
    return paystack.startPayment({
      order,
      buyer,
      callbackUrl: `${base}/api/payments/paystack/callback?order=${order.id}`,
    });
  }
  return payfast.buildPaymentUrl({
    order,
    buyer,
    returnUrl: `${base}/api/payments/payfast/return?order=${order.id}`,
    cancelUrl: `${base}/api/payments/payfast/cancel?order=${order.id}`,
    notifyUrl: `${base}/api/payments/payfast/notify`,
  });
}

module.exports = { provider, paymentLinkFor };
