-- Build 3 (Oct 2026): delete my account, promo codes, saved addresses,
-- favourite restaurants, written reviews, driver tips, orders for later.

-- A deleted account keeps its row (orders, payouts and statements point at
-- it) but every personal detail on it is wiped; see DELETE /api/auth/account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Where a customer usually has food sent: "Home", "Work", "Gogo's house".
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  line TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id, last_used_at DESC);

CREATE TABLE IF NOT EXISTS favourites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, restaurant_id)
);

-- Promo codes, made by MidFood on the admin page. The discount always comes
-- off MidFood's side: the kitchen is still paid on the full food total and
-- the driver on the full delivery fee (see src/promos.js and src/money.js).
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                  -- stored upper-case, no spaces
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed', 'free_delivery')),
  value NUMERIC(10, 2) NOT NULL DEFAULT 0,    -- percent (10 = 10%) or rands off; unused for free_delivery
  min_subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(10, 2),                -- cap for percent codes ("10% off, up to R50")
  max_uses INTEGER,                           -- across all customers; NULL = no limit
  once_per_customer BOOLEAN NOT NULL DEFAULT true,
  first_order_only BOOLEAN NOT NULL DEFAULT false,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE, -- NULL = any kitchen
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,                                  -- for Sipho's eyes: "Flyer launch", "Chef Lue opening"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the customer paid is now: subtotal - discount + delivery_fee + tip.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip NUMERIC(10, 2) NOT NULL DEFAULT 0;
-- When the customer wants it, for "order for later"; NULL means as soon as possible.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
-- A few words with the stars, shown on the restaurant's page.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_promo ON orders(promo_code) WHERE promo_code IS NOT NULL;
