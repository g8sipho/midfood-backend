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

-- When the money actually arrived. An order can be created long before it is
-- paid (a customer who comes back and taps "Pay now"), and "how long has this
-- kitchen kept a customer waiting" has to count from payment, not creation.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
UPDATE orders SET paid_at = created_at WHERE payment_status = 'paid' AND paid_at IS NULL;

-- A customer who pays twice for one order (PayFast was slow to confirm, so
-- they tapped "Pay now" again). The order is only worth one payment; the
-- second is money owed straight back. Keyed on PayFast's own payment id, so a
-- repeated notification can never record the same payment twice.
CREATE TABLE IF NOT EXISTS extra_payments (
  pf_payment_id TEXT PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,
  refund_reference TEXT
);

-- Everything before this moment was paid with PayFast's sandbox: test cards,
-- no real money. A declined test order from back then is not a refund anyone
-- is owed, so it is closed off here rather than left on the admin page as a
-- debt. The cut-off is fixed, so this can never touch a real order.
UPDATE orders
SET refunded_at = updated_at, refund_reference = 'Test payment before go-live (no real money moved)'
WHERE status = 'rejected' AND payment_status = 'paid' AND refunded_at IS NULL
  AND created_at < TIMESTAMPTZ '2026-10-08 12:00:00+02';
