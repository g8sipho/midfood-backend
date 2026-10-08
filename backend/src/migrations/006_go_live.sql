-- Going live with real payments.
--
-- Three things the platform needed before real money moves:
--   1. Refund tracking. A paid order the kitchen declines (or MidFood cancels)
--      is money owed back to the customer. It has to be impossible to lose.
--   2. A delivery pin. Street addresses are unreliable in much of Middelburg,
--      so the customer can drop a GPS pin at checkout. The driver navigates to
--      it and the customer's live map shows it.
--   3. The payout day, so the portal and driver app can say when money lands.
--
-- Safe to re-run, like every other migration here.

-- Where to deliver, if the customer shared it. Both NULL when they did not.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;

-- Refunds. An order needs one when it was paid for and then rejected/cancelled.
-- refunded_at stays NULL until you have actually sent the money back in PayFast
-- and recorded it on the admin page.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reference TEXT;
-- Who ended a rejected order: 'restaurant' (declined it) or 'admin' (cancelled).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_refund_due
  ON orders(updated_at) WHERE status = 'rejected' AND payment_status = 'paid' AND refunded_at IS NULL;

-- The day of the week payouts go out. Shown to restaurants and drivers.
INSERT INTO settings (key, value) VALUES ('payout_day', 'Tuesday')
ON CONFLICT (key) DO NOTHING;
