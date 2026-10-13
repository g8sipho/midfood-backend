-- "Forgot password" for customers: a short code is emailed to the address on
-- the account and has to be typed back within 15 minutes. Only a hash of the
-- code is kept, and a handful of wrong guesses burns it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_sent_at TIMESTAMPTZ;
