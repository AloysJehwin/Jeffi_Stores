-- Single migration file. Overwrite this file with the next migration before deploying.
-- This file is run by the CI/CD pipeline on every deploy to main.
-- Use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to re-run.

-- coupon_eligible_users: tracks which users are allowed to use a specific coupon (via mailer)
CREATE TABLE IF NOT EXISTS coupon_eligible_users (
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ceu_user_id ON coupon_eligible_users(user_id);

-- Add a new unique constraint that includes sub_variant_id
ALTER TABLE cart_items ADD CONSTRAINT IF NOT EXISTS cart_items_user_product_variant_subvariant_key
  UNIQUE (user_id, product_id, variant_id, sub_variant_id);
