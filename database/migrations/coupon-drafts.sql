CREATE TABLE IF NOT EXISTS coupon_drafts (
  coupon_id uuid PRIMARY KEY REFERENCES coupons(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
