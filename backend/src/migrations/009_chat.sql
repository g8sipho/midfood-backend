-- Customer chat.
--
-- A customer talks to one kitchen at a time (or to MidFood itself, when
-- restaurant_id is NULL). One conversation per customer+restaurant, reused
-- across orders; the order a message is about is kept on the conversation as
-- "the order being discussed right now" so the bot can answer "where is my
-- food?" without the customer saying which order.
--
-- Senders: 'customer' (the phone app or /order/ page), 'restaurant' (the
-- portal), 'admin' (MidFood, from the admin page), 'bot' (the automatic
-- answers in src/chatbot.js).
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  -- Set when the customer asked for a person (or the bot could not help):
  -- the portal shows these first, with a "needs a reply" flag.
  needs_human BOOLEAN NOT NULL DEFAULT false,
  customer_unread INTEGER NOT NULL DEFAULT 0,
  restaurant_unread INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_sender TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One thread per customer and kitchen. NULLs are distinct in a unique index,
-- so the MidFood-support thread (restaurant_id NULL) gets its own row too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_restaurant
  ON conversations(user_id, restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_support
  ON conversations(user_id) WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_restaurant ON conversations(restaurant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer', 'restaurant', 'admin', 'bot')),
  body TEXT NOT NULL,
  -- Tap-to-send suggestions the bot attaches to its own replies, as a JSON
  -- array of short strings. NULL on every other message.
  quick_replies JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
