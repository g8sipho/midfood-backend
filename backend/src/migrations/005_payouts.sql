-- Commission and payouts.
--
-- Every paid order records, at the moment the kitchen is paid-for, exactly how
-- the money splits. Those figures are frozen onto the order rather than
-- recalculated later, so changing the commission rate never rewrites history
-- and a statement issued last month still adds up next year.
--
--   total = subtotal + delivery_fee
--   commission        = subtotal x commission_rate      (MidFood's cut)
--   restaurant_payout = subtotal - commission           (owed to the kitchen)
--   driver_payout     = delivery_fee - delivery_cut     (owed to the driver)
--   delivery_cut      = delivery_fee x delivery_cut_rate (MidFood's slice, if any)

-- Per-restaurant commission, so a launch deal or a special rate is possible
-- without touching anyone else. NULL means "use the platform default".
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 4);
-- When the free period ends. NULL = no free period. While now() is before it,
-- the restaurant is charged 0% whatever the rate says.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS free_until DATE;

-- Frozen money split, written once when payment is confirmed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_payout NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_payout NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_cut NUMERIC(10, 2);

-- Platform-wide settings, so the default rate can change without a deploy.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('commission_rate', '0.15'),
  ('delivery_cut_rate', '0'),
  ('free_months', '3')
ON CONFLICT (key) DO NOTHING;

-- A payout is one settled payment to one restaurant or one driver, covering a
-- period. Orders point at it once paid out, so nothing is ever paid twice.
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY,
  payee_type TEXT NOT NULL CHECK (payee_type IN ('restaurant', 'driver')),
  restaurant_id UUID REFERENCES restaurants(id),
  driver_id UUID REFERENCES drivers(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  order_count INTEGER NOT NULL,
  gross NUMERIC(10, 2) NOT NULL,       -- food (restaurant) or delivery fees (driver)
  deductions NUMERIC(10, 2) NOT NULL,  -- commission, or MidFood's delivery slice
  amount NUMERIC(10, 2) NOT NULL,      -- what actually gets transferred
  reference TEXT,                      -- your EFT reference
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payee_matches_type CHECK (
    (payee_type = 'restaurant' AND restaurant_id IS NOT NULL AND driver_id IS NULL) OR
    (payee_type = 'driver' AND driver_id IS NOT NULL AND restaurant_id IS NULL)
  )
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_payout_id UUID REFERENCES payouts(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_payout_id UUID REFERENCES payouts(id);

CREATE INDEX IF NOT EXISTS idx_orders_restaurant_payout ON orders(restaurant_payout_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver_payout ON orders(driver_payout_id);
CREATE INDEX IF NOT EXISTS idx_payouts_restaurant ON payouts(restaurant_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_payouts_driver ON payouts(driver_id, paid_at);

-- Bank details, so you know where to send the money. Kept deliberately plain:
-- MidFood stores what you need to make an EFT, nothing more.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
