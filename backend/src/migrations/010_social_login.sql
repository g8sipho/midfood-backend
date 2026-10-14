-- "Continue with Google / Facebook": a customer's account can be tied to the
-- id the provider gives us, and such an account may have no password at all
-- (they can set one later from the app, or through "forgot password").
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_facebook_id_key ON users (facebook_id) WHERE facebook_id IS NOT NULL;
