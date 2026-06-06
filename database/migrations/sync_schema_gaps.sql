-- Sync schema gaps between local and live RDS
-- Columns present on live but missing locally, and vice versa.

-- admin_certificates: e-invoice P12 cert storage
ALTER TABLE admin_certificates
  ADD COLUMN IF NOT EXISTS p12_data     bytea,
  ADD COLUMN IF NOT EXISTS p12_password varchar(64);

-- product_variants: variant display/pricing flags
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sub_variant_type_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weight_rate_on      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS length_rate_on      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS use_own_images      boolean NOT NULL DEFAULT false;

-- variant_images: alt text for SEO
ALTER TABLE variant_images
  ADD COLUMN IF NOT EXISTS alt_text varchar(255);

-- campaigns: coupon linkage (present on local, add to live)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL;
