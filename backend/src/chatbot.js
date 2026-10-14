// The instant answers in customer chat.
//
// Every message a customer sends to a kitchen (or to MidFood) goes through
// here first. Plain questions -- where is my order, are you open, what does
// delivery cost, do you have X -- get an answer straight away from what the
// database already knows, so nobody waits on a busy kitchen for facts the
// app can see. Anything that needs a person (cancel, change, refund, a
// complaint, or simply "talk to someone") is flagged `needs_human`, which puts
// the thread at the top of the portal's chat list with a red marker.
//
// It is deliberately a set of rules, not a language model: the answers come
// from the order and menu tables, so they are never made up, and it costs
// nothing per message.
const { pool } = require('./db');

const SUPPORT_PHONE = '072 643 7784';

const ORDER_WORDS = /\b(order|food|driver|delivery|deliver|where|how long|eta|late|status|track|arriv|coming|on (its|the) way|ready|waiting|when)\b/i;
const OPEN_WORDS = /\b(open|close|closed|closing|hours|trading|time do you|still (taking|open)|busy)\b/i;
const FEE_WORDS = /\b(delivery fee|delivery cost|delivery charge|how much (is|for) delivery|deliver to|delivery area|do you deliver|fee|charge for delivery)\b/i;
const MENU_WORDS = /\b(menu|price|prices|how much|cost|do you (have|sell|do|make)|special|specials|halal|vegetarian|vegan|options|what do you)\b/i;
const CANCEL_WORDS = /\b(cancel|change|wrong|mistake|add|remove|forgot|instead|edit|update my|different address|wrong address)\b/i;
const REFUND_WORDS = /\b(refund|money back|charged|paid twice|double|payment|pay|payfast|declined|didn'?t go through)\b/i;
const HUMAN_WORDS = /\b(person|human|someone|owner|manager|staff|agent|speak|talk|call me|phone me|real|complain|complaint|problem|issue|cold|missing|wrong item|bad|terrible|rude|not happy|unhappy)\b/i;
const GREETING = /^\s*(hi|hello|hey|hallo|howzit|good (morning|afternoon|evening|day)|sawubona|dumela|molo|yo|hola)\b/i;
const THANKS = /\b(thanks|thank you|thank u|thx|shot|dankie|ngiyabonga|ke a leboga|enkosi|appreciate|great|perfect|cool)\b/i;

const STATUS_LABEL = {
  placed: 'waiting for the kitchen to accept it',
  confirmed: 'accepted by the kitchen',
  preparing: 'being prepared',
  out_for_delivery: 'on its way',
  delivered: 'delivered',
  rejected: 'declined',
};

function minutesSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

function rands(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `R${v}` : `R${v.toFixed(2)}`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function clockTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Johannesburg',
    });
  } catch {
    return '';
  }
}

// The order the customer most likely means: the one pinned to the thread if
// it is still live, otherwise their newest paid order with this kitchen (or
// anywhere, for the MidFood thread) from the last day.
async function findOrder(convo) {
  if (convo.order_id) {
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} ${ORDER_FROM} WHERE o.id = $1`, [convo.order_id]);
    const pinned = rows[0];
    if (pinned && !['delivered', 'rejected'].includes(pinned.status) && minutesSince(pinned.createdAt) < 24 * 60) {
      return pinned;
    }
  }
  const params = [convo.user_id];
  let where = `o.user_id = $1 AND o.created_at > now() - interval '36 hours'`;
  if (convo.restaurant_id) {
    params.push(convo.restaurant_id);
    where += ` AND o.restaurant_id = $2`;
  }
  const { rows } = await pool.query(
    `SELECT ${ORDER_COLS} ${ORDER_FROM} WHERE ${where}
     ORDER BY (o.status NOT IN ('delivered','rejected')) DESC, o.created_at DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

const ORDER_COLS = `o.id, o.status, o.payment_status AS "paymentStatus", o.restaurant_name AS "restaurantName",
  o.total::float8 AS total, o.delivery_address AS "deliveryAddress", o.rejected_reason AS "rejectedReason",
  o.refunded_at AS "refundedAt", o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.ready_at AS "readyAt",
  r.eta_minutes AS "etaMinutes", d.name AS "driverName", d.phone AS "driverPhone"`;
const ORDER_FROM = `FROM orders o JOIN restaurants r ON r.id = o.restaurant_id LEFT JOIN drivers d ON d.id = o.driver_id`;

function describeOrder(order, kitchen) {
  const age = minutesSince(order.createdAt);
  const eta = Math.max(5, (order.etaMinutes || 35) - (age || 0));
  if (order.paymentStatus !== 'paid') {
    return {
      text: `Your order with ${order.restaurantName} (${rands(order.total)}) is still waiting for payment, so the kitchen can't see it yet. Open the order in My orders and tap "Retry payment" to finish paying.`,
      quick: ['Talk to a person'],
    };
  }
  switch (order.status) {
    case 'placed':
      return {
        text: `Your order (${rands(order.total)}) reached ${kitchen} ${age <= 1 ? 'just now' : `${age} minutes ago`} and is waiting for the kitchen to accept it. Most orders are accepted within a few minutes. I'll flag it for them.`,
        quick: ['Talk to a person'],
        flag: age >= 8,
      };
    case 'confirmed':
      return {
        text: `${kitchen} has accepted your order and is about to start on it. Expect it in roughly ${eta} minutes, and a notification at every step.`,
        quick: ['Talk to a person'],
      };
    case 'preparing':
      return {
        text: `Your food is being prepared right now at ${kitchen}. It should be with you in about ${eta} minutes. A driver is called the moment it's ready.`,
        quick: ['Talk to a person'],
      };
    case 'out_for_delivery':
      return {
        text: order.driverName
          ? `Your order is on its way with ${order.driverName}${order.driverPhone ? ` (${order.driverPhone})` : ''}. You can watch the driver on the map on your order screen.`
          : `Your order is on its way. Watch the driver on the map on your order screen.`,
        quick: ['Talk to a person'],
      };
    case 'delivered':
      return {
        text: `That order was delivered at ${clockTime(order.updatedAt)}. If something was wrong with it, tell me what happened and I'll get a person onto it.`,
        quick: ['Something was wrong', 'Thanks'],
      };
    case 'rejected':
      return {
        text: `${kitchen} couldn't take that order${order.rejectedReason ? ` (${order.rejectedReason})` : ''}. ${
          order.refundedAt
            ? 'Your payment has been refunded.'
            : 'Your payment will be refunded; it shows on your card within 3 working days.'
        } Anything else I can help with?`,
        quick: ['Talk to a person'],
      };
    default:
      return { text: `Your order is ${STATUS_LABEL[order.status] || order.status}.`, quick: [] };
  }
}

async function menuAnswer(convo, text, kitchen) {
  if (!convo.restaurant_id) {
    return {
      text: `Each restaurant's menu is on its own page in the app, with photos and prices. Open a restaurant from Home and tap a dish to see it big.`,
      quick: ['Where is my order?', 'Talk to a person'],
    };
  }
  const { rows: menu } = await pool.query(
    `SELECT name, price::float8 AS price, category FROM menu_items WHERE restaurant_id = $1 AND available = true ORDER BY name`,
    [convo.restaurant_id]
  );
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(menu|price|prices|much|cost|does|have|sell|what|your|the|and|for|you|are|any|with|special|specials|there|how|got)$/.test(w));
  const hits = menu.filter((m) => words.some((w) => m.name.toLowerCase().includes(w) || (m.category || '').toLowerCase().includes(w)));
  if (hits.length) {
    const list = hits.slice(0, 4).map((m) => `${m.name} — ${rands(m.price)}`).join('\n');
    return {
      text: `Yes! On the ${kitchen} menu:\n${list}${hits.length > 4 ? `\n…and ${hits.length - 4} more.` : ''}\nTap a dish on the menu to add it to your order.`,
      quick: ['Delivery fee', 'Are you open?'],
    };
  }
  if (words.length && menu.length) {
    const sections = [...new Set(menu.map((m) => (m.category || '').trim()).filter(Boolean))];
    return {
      text: `I couldn't find that on the ${kitchen} menu. They have ${menu.length} dishes${sections.length ? ` in ${sections.slice(0, 5).join(', ')}` : ''}. I've passed your question to the kitchen in case it's something they can make.`,
      quick: ['Delivery fee', 'Talk to a person'],
      flag: true,
    };
  }
  const cheapest = menu.length ? Math.min(...menu.map((m) => m.price)) : null;
  return {
    text: menu.length
      ? `${kitchen} has ${menu.length} dishes on the menu, from ${rands(cheapest)}. Ask me about a specific dish ("do you have wings?") or open the menu to browse with photos.`
      : `${kitchen} hasn't loaded a menu yet. I've let them know you're asking.`,
    quick: ['Are you open?', 'Delivery fee'],
    flag: !menu.length,
  };
}

// Works out what the customer asked and answers it. Returns null when the
// bot should stay quiet (a person is already mid-conversation and the
// message isn't a plain question), or
// { text, quickReplies, needsHuman } for a reply to store.
async function respond(convo, text, options = {}) {
  const { humanActive = false } = options;
  const msg = String(text || '').trim();
  if (!msg) return null;

  const kitchen = convo.restaurant_name || 'MidFood';
  const support = !convo.restaurant_id;
  const name = firstName(convo.customer_name);
  const quickDefault = support
    ? ['Where is my order?', 'Refund question', 'Talk to a person']
    : ['Where is my order?', 'Are you open?', 'Delivery fee', 'Talk to a person'];

  const wants = {
    human: HUMAN_WORDS.test(msg),
    order: ORDER_WORDS.test(msg),
    open: OPEN_WORDS.test(msg),
    fee: FEE_WORDS.test(msg),
    menu: MENU_WORDS.test(msg),
    cancel: CANCEL_WORDS.test(msg),
    refund: REFUND_WORDS.test(msg),
    greeting: GREETING.test(msg) && msg.length < 40,
    thanks: THANKS.test(msg) && msg.length < 60,
  };

  // While a person at the kitchen is mid-conversation, the bot only chips in
  // with hard facts it can look up (order status, hours, delivery) and
  // otherwise leaves the thread to them.
  if (humanActive && !wants.order && !wants.open && !wants.fee) return null;

  // "Talk to a person" and anything that smells like a complaint goes to
  // people first, whatever else the message mentions.
  if (wants.human) {
    return {
      text: support
        ? `I've let the MidFood team know. Someone will reply here, or you can call or WhatsApp ${SUPPORT_PHONE}.`
        : `I've let ${kitchen} know you'd like to speak to someone. A person will reply right here, usually within a few minutes while the kitchen is open. If it's urgent, MidFood is on ${SUPPORT_PHONE}.`,
      quickReplies: [],
      needsHuman: true,
    };
  }

  if (wants.cancel) {
    const order = await findOrder(convo);
    let text;
    if (order && order.paymentStatus === 'paid' && order.status === 'placed') {
      text = `Your order hasn't been accepted by the kitchen yet, so there's still time. I've flagged your message so ${kitchen} sees it before they start cooking.`;
    } else if (order && ['confirmed', 'preparing'].includes(order.status)) {
      text = `The kitchen has already started on your order, so changes aren't guaranteed, but I've flagged your message for ${kitchen} to look at right now.`;
    } else if (order && order.status === 'out_for_delivery') {
      text = `Your order is already with the driver${order.driverName ? `, ${order.driverName}` : ''}${order.driverPhone ? ` (${order.driverPhone})` : ''}. For a change of address, the quickest way is to call the driver.`;
    } else {
      text = `I can't see a live order to change. If this is about a past order, tell me what happened and a person will sort it out.`;
    }
    return { text, quickReplies: ['Talk to a person'], needsHuman: true };
  }

  if (wants.refund) {
    if (humanActive) return null;
    const order = await findOrder(convo);
    const base = `Refunds for declined orders are paid back to the card you used, within 3 working days. MidFood handles them, not the kitchen.`;
    const extra =
      order && order.status === 'rejected'
        ? order.refundedAt
          ? ` Your last order's refund has been sent.`
          : ` Your declined order is in the refund queue.`
        : '';
    return { text: `${base}${extra} I've flagged this for a person to confirm with you.`, quickReplies: [], needsHuman: true };
  }

  if (wants.fee && !support) {
    const { rows } = await pool.query('SELECT delivery_fee::float8 AS fee, eta_minutes AS eta FROM restaurants WHERE id = $1', [convo.restaurant_id]);
    const r = rows[0] || {};
    return {
      text: `Delivery from ${kitchen} is ${r.fee ? rands(r.fee) : 'free'} anywhere in Middelburg, usually about ${r.eta || 35} minutes. You see the exact total before you pay.`,
      quickReplies: ['Are you open?', 'Where is my order?'],
      needsHuman: false,
    };
  }

  if (wants.order) {
    const order = await findOrder(convo);
    if (!order) {
      return {
        text: support
          ? `I can't see a recent order on your account. If you paid and it's missing, tell me the time and the restaurant and a person will check.`
          : `I can't see a recent order from you at ${kitchen}. Once you've ordered, ask me here and I'll tell you exactly where it is.`,
        quickReplies: support ? ['Talk to a person'] : ['Are you open?', 'Delivery fee'],
        needsHuman: false,
      };
    }
    const d = describeOrder(order, order.restaurantName || kitchen);
    return { text: d.text, quickReplies: d.quick, needsHuman: Boolean(d.flag) };
  }

  if (wants.open && !support) {
    const { rows } = await pool.query('SELECT open, eta_minutes AS eta FROM restaurants WHERE id = $1', [convo.restaurant_id]);
    const r = rows[0] || {};
    return {
      text: r.open
        ? `${kitchen} is open and taking orders right now. Delivery is usually about ${r.eta || 35} minutes.`
        : `${kitchen} is closed at the moment, so orders can't be placed. You can still browse the menu, and the app shows "Open" the moment they switch on.`,
      quickReplies: r.open ? ['Delivery fee', 'Where is my order?'] : ['Talk to a person'],
      needsHuman: false,
    };
  }

  if (wants.menu) {
    if (humanActive) return null;
    const m = await menuAnswer(convo, msg, kitchen);
    return { text: m.text, quickReplies: m.quick, needsHuman: Boolean(m.flag) };
  }

  if (wants.thanks) {
    return { text: `Pleasure, ${name}! Enjoy your meal 🍽️`, quickReplies: [], needsHuman: false };
  }

  if (wants.greeting) {
    if (humanActive) return null;
    return {
      text: support
        ? `Hi ${name}! I'm MidFood's assistant. I can check on an order or explain refunds; for anything else a person from MidFood will pick up here.`
        : `Hi ${name}! I'm the ${kitchen} assistant. Ask me where your order is, what's on the menu, or about delivery — and tap "Talk to a person" any time to reach the kitchen.`,
      quickReplies: quickDefault,
      needsHuman: false,
    };
  }

  // Nothing matched. If a person is already talking, leave it to them;
  // otherwise promise a human and flag the thread.
  if (humanActive) return null;
  return {
    text: support
      ? `Thanks, I've passed that to the MidFood team — someone will reply here. Or call ${SUPPORT_PHONE}.`
      : `Thanks, I've passed that on to ${kitchen}. They'll reply right here. While you wait I can answer these:`,
    quickReplies: quickDefault,
    needsHuman: true,
  };
}

// The first message in a brand-new thread, so the customer knows the bot is
// there and what to ask it.
function welcome(convo) {
  const kitchen = convo.restaurant_name;
  const name = firstName(convo.customer_name);
  return kitchen
    ? {
        text: `Hi ${name} 👋 You're chatting with ${kitchen}. I answer the quick questions instantly; the kitchen answers the rest.`,
        quickReplies: ['Where is my order?', 'Are you open?', 'Delivery fee', 'Talk to a person'],
      }
    : {
        text: `Hi ${name} 👋 This is MidFood support. Ask about an order or a refund, and a person picks up anything I can't answer.`,
        quickReplies: ['Where is my order?', 'Refund question', 'Talk to a person'],
      };
}

module.exports = { respond, welcome, SUPPORT_PHONE };
