-- Restaurant portal: lets each restaurant log in and manage their own menu
-- instead of it being hardcoded seed data. Adds owner login credentials to
-- restaurants, and a per-item availability flag so owners can mark things
-- sold out without deleting them. Run automatically alongside 001_init.sql
-- on server startup (see src/db.js) -- safe to run multiple times.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- A plain UNIQUE column constraint can't be added idempotently via
-- ALTER TABLE ADD COLUMN, so enforce uniqueness with an index instead.
-- Partial (WHERE username IS NOT NULL) so restaurants without a portal
-- account yet (multiple NULLs) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_username
  ON restaurants(username) WHERE username IS NOT NULL;

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;
