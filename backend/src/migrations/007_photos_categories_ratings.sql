-- What customers expect from a food app: pictures of the food, a menu laid
-- out in sections, and star ratings that real customers gave.
--
-- Safe to re-run, like every other migration here.

-- Photos. Stored in the database itself: Render's disk is wiped on every
-- deploy, and a second storage service is more than a town-sized menu needs.
-- Each picture belongs to exactly one dish or one restaurant, and goes when
-- its owner goes. A replaced picture gets a new id, so a picture's address
-- never changes its content and browsers can keep it for good.
CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY,
  menu_item_id UUID UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  restaurant_id UUID UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  bytes INTEGER NOT NULL,
  -- A small square copy for menu lists, so scrolling a menu on mobile data
  -- costs a few kilobytes a dish rather than a full photo each.
  thumb BYTEA,
  thumb_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT image_has_one_owner CHECK (
    (menu_item_id IS NOT NULL AND restaurant_id IS NULL) OR
    (menu_item_id IS NULL AND restaurant_id IS NOT NULL)
  )
);

-- The section of the menu a dish sits under ("Platters", "Cakes"). NULL means
-- the restaurant has not sorted its menu into sections.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category TEXT;

-- A customer's rating of a delivered order, 1 to 5 stars. A restaurant's
-- rating is the average of these and nothing else.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating SMALLINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_rated ON orders(restaurant_id) WHERE rating IS NOT NULL;
