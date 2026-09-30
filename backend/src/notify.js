// Customer push notifications via Expo's push service. Best-effort: a failed
// push must never break an order update, so every error is swallowed+logged.
const { pool } = require('./db');

const MESSAGES = {
  confirmed: ['Order accepted', 'The restaurant has accepted your order.'],
  preparing: ['Being prepared', 'Your food is being prepared.'],
  ready: ['Ready for pickup', 'Your order is ready and waiting for a driver.'],
  out_for_delivery: ['On the way', 'Your driver has picked up your order.'],
  delivered: ['Delivered', 'Enjoy your meal!'],
  rejected: ['Order declined', 'Sorry, the restaurant could not take your order.'],
};

async function notifyOrderStatus(orderId, key) {
  try {
    const msg = MESSAGES[key];
    if (!msg) return;
    const { rows } = await pool.query(
      `SELECT u.push_token AS token, o.restaurant_name AS rn FROM orders o
       JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId]
    );
    const row = rows[0];
    if (!row || !row.token || !/^Expo(nent)?PushToken\[/.test(row.token)) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: row.token,
        title: msg[0],
        body: `${row.rn}: ${msg[1]}`,
        data: { orderId },
        sound: 'default',
      }),
    });
  } catch (err) {
    console.error('Push notification failed:', err.message);
  }
}

module.exports = { notifyOrderStatus };
