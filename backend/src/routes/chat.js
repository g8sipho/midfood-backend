// Customer chat: a thread per kitchen (and one with MidFood itself).
//
// The phone app and the /order/ page use these. Every customer message is
// answered by the bot in src/chatbot.js when it can; the kitchen reads and
// replies through /api/portal/chats, MidFood through /api/admin/chats.
const express = require('express');
const { pool, uuid } = require('../db');
const { requireAuth } = require('../middleware/auth');
const chatbot = require('../chatbot');

const router = express.Router();
router.use(requireAuth);

const MAX_BODY = 1000;

// A kitchen counts as "in the conversation" for this long after its last
// message; the bot then leaves open questions to the person.
const HUMAN_ACTIVE_MS = 15 * 60 * 1000;

const CONVO_COLS = `c.id, c.restaurant_id AS "restaurantId", c.order_id AS "orderId",
  c.needs_human AS "needsHuman", c.customer_unread AS "unread",
  c.last_message AS "lastMessage", c.last_sender AS "lastSender", c.last_message_at AS "lastMessageAt",
  COALESCE(r.name, 'MidFood support') AS "title", r.hero_color AS "heroColor", r.open,
  (SELECT i.id FROM images i WHERE i.restaurant_id = r.id) AS "imageId"`;
const CONVO_FROM = `FROM conversations c LEFT JOIN restaurants r ON r.id = c.restaurant_id`;

function shapeConvo(row) {
  row.thumbUrl = row.imageId ? `/api/images/${row.imageId}/thumb` : null;
  delete row.imageId;
  return row;
}

function shapeMessage(m) {
  return {
    id: m.id,
    sender: m.sender,
    body: m.body,
    quickReplies: m.quick_replies || m.quickReplies || null,
    createdAt: m.created_at || m.createdAt,
  };
}

// Everything the bot needs to know about a thread, in one row.
async function loadConvoForBot(db, id) {
  const { rows } = await db.query(
    `SELECT c.*, r.name AS restaurant_name, u.name AS customer_name,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id AND m.sender IN ('restaurant','admin')) AS last_human_at
     FROM conversations c
     LEFT JOIN restaurants r ON r.id = c.restaurant_id
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insertMessage(client, conversationId, sender, body, quickReplies) {
  const id = uuid();
  const { rows } = await client.query(
    `INSERT INTO messages (id, conversation_id, sender, body, quick_replies)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, sender, body, quick_replies, created_at`,
    [id, conversationId, sender, body, quickReplies && quickReplies.length ? JSON.stringify(quickReplies) : null]
  );
  return rows[0];
}

// Keeps the thread's preview and unread counters in step with a new message.
async function touchConversation(client, conversationId, sender, body, extra = {}) {
  const forCustomer = sender !== 'customer';
  const forKitchen = sender === 'customer';
  await client.query(
    `UPDATE conversations SET
       last_message = $2, last_sender = $3, last_message_at = now(),
       customer_unread = customer_unread + $4,
       restaurant_unread = restaurant_unread + $5,
       needs_human = CASE WHEN $6::boolean IS NULL THEN needs_human ELSE $6 END,
       order_id = COALESCE($7::uuid, order_id)
     WHERE id = $1`,
    [
      conversationId,
      body.slice(0, 140),
      sender,
      forCustomer ? 1 : 0,
      forKitchen ? 1 : 0,
      extra.needsHuman === undefined ? null : extra.needsHuman,
      extra.orderId || null,
    ]
  );
}

// GET /api/chat/conversations - the customer's threads, newest first.
router.get('/conversations', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${CONVO_COLS} ${CONVO_FROM} WHERE c.user_id = $1 ORDER BY c.last_message_at DESC`,
      [req.userId]
    );
    res.json({ conversations: rows.map(shapeConvo) });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/unread - one number for the tab badge.
router.get('/unread', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(SUM(customer_unread), 0)::int AS unread FROM conversations WHERE user_id = $1',
      [req.userId]
    );
    res.json({ unread: rows[0].unread });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/conversations { restaurantId?, orderId? }
// Opens (or finds) the thread with that kitchen; no restaurantId means the
// MidFood support thread. With an orderId the thread is pointed at that order
// so "where is my order?" needs no explaining.
router.post('/conversations', async (req, res, next) => {
  const { restaurantId, orderId } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let rid = restaurantId || null;
    let oid = null;
    if (orderId) {
      const { rows } = await client.query('SELECT id, restaurant_id FROM orders WHERE id = $1 AND user_id = $2', [orderId, req.userId]);
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }
      oid = rows[0].id;
      if (!rid) rid = rows[0].restaurant_id;
    }
    if (rid) {
      const { rows } = await client.query('SELECT id FROM restaurants WHERE id = $1 AND approved = true', [rid]);
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Restaurant not found' });
      }
    }

    const existing = await client.query(
      rid
        ? 'SELECT id FROM conversations WHERE user_id = $1 AND restaurant_id = $2'
        : 'SELECT id FROM conversations WHERE user_id = $1 AND restaurant_id IS NULL',
      rid ? [req.userId, rid] : [req.userId]
    );
    let id = existing.rows[0] && existing.rows[0].id;
    let created = false;
    if (!id) {
      id = uuid();
      await client.query(
        'INSERT INTO conversations (id, user_id, restaurant_id, order_id) VALUES ($1, $2, $3, $4)',
        [id, req.userId, rid, oid]
      );
      created = true;
    } else if (oid) {
      await client.query('UPDATE conversations SET order_id = $2 WHERE id = $1', [id, oid]);
    }

    if (created) {
      const convo = await loadConvoForBot(client, id);
      const hello = chatbot.welcome(convo);
      await insertMessage(client, id, 'bot', hello.text, hello.quickReplies);
      // A greeting is not something to be nagged about.
      await client.query(
        `UPDATE conversations SET last_message = $2, last_sender = 'bot', last_message_at = now() WHERE id = $1`,
        [id, hello.text.slice(0, 140)]
      );
    }
    await client.query('COMMIT');

    const { rows } = await pool.query(`SELECT ${CONVO_COLS} ${CONVO_FROM} WHERE c.id = $1`, [id]);
    res.status(created ? 201 : 200).json({ conversation: shapeConvo(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

async function ownConversation(req, res) {
  const { rows } = await pool.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'Conversation not found' });
    return false;
  }
  return true;
}

// GET /api/chat/conversations/:id/messages?after=<iso>
// Reading the thread clears the customer's unread count.
router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    if (!(await ownConversation(req, res))) return;
    const after = req.query.after ? new Date(String(req.query.after)) : null;
    const params = [req.params.id];
    let where = 'conversation_id = $1';
    if (after && !Number.isNaN(after.getTime())) {
      params.push(after.toISOString());
      where += ' AND created_at > $2';
    }
    const { rows } = await pool.query(
      `SELECT id, sender, body, quick_replies, created_at FROM messages WHERE ${where} ORDER BY created_at ASC LIMIT 200`,
      params
    );
    await pool.query('UPDATE conversations SET customer_unread = 0 WHERE id = $1 AND customer_unread > 0', [req.params.id]);
    res.json({ messages: rows.map(shapeMessage) });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/conversations/:id/messages { body }
// Stores the customer's message and, when the bot has an answer, its reply.
router.post('/conversations/:id/messages', async (req, res, next) => {
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Type a message first' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters` });

  const client = await pool.connect();
  try {
    if (!(await ownConversation(req, res))) return;
    const convo = await loadConvoForBot(pool, req.params.id);

    await client.query('BEGIN');
    const mine = await insertMessage(client, convo.id, 'customer', body, null);
    await touchConversation(client, convo.id, 'customer', body);

    const humanActive = convo.last_human_at && Date.now() - new Date(convo.last_human_at).getTime() < HUMAN_ACTIVE_MS;
    let reply = null;
    const answer = await chatbot.respond(convo, body, { humanActive: Boolean(humanActive) });
    if (answer) {
      reply = await insertMessage(client, convo.id, 'bot', answer.text, answer.quickReplies);
      // The bot's own reply must not show as unread for the customer who is
      // looking at the screen, and must not count against the kitchen.
      await client.query(
        `UPDATE conversations SET last_message = $2, last_sender = 'bot', last_message_at = now(),
           needs_human = needs_human OR $3
         WHERE id = $1`,
        [convo.id, answer.text.slice(0, 140), Boolean(answer.needsHuman)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: shapeMessage(mine), reply: reply ? shapeMessage(reply) : null });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = { router, insertMessage, touchConversation, shapeMessage, CONVO_COLS, CONVO_FROM };
