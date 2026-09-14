-- Payments (PayFast): tracks whether an order has actually been paid for,
-- separately from its kitchen/delivery status (which stays on the existing
-- `status` column and STATUS_FLOW in routes/orders.js). An order is still
-- created immediately at checkout (payment_status defaults to 'pending') so
-- nothing is lost if a customer abandons payment partway through; PayFast's
-- server-to-server ITN (see src/routes/payments.js) flips it to 'paid' once
-- money has actually moved.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT;
