-- Wave 4: Marketing automation & campaigns
-- Campaign config, send tracking, opt-out, single-use coupons, wishlist snapshots

-- ===== campaigns: one row per campaign kind, settings live here =====
CREATE TABLE IF NOT EXISTS campaigns (
  kind             VARCHAR(64) PRIMARY KEY,
  name             VARCHAR(128) NOT NULL,
  description      TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  delay_hours      INTEGER NOT NULL DEFAULT 24,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT NOT NULL,
  body_template    TEXT NOT NULL,
  last_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO campaigns (kind, name, description, enabled, delay_hours, discount_percent, subject_template, body_template) VALUES
  ('abandoned_cart',     'Abandoned Cart',
   'Customer left items in cart without checking out',
   TRUE, 24, 0,
   'You left something in your cart, {firstName}',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Still thinking it over?</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;">You left {itemCount} item(s) in your cart. We held onto them for you.</p>{cartItems}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Resume your order</a></p>'),
  ('abandoned_checkout', 'Abandoned Checkout',
   'Order auto-cancelled after 10-min payment window expired',
   TRUE, 1, 0,
   'Complete your purchase, {firstName}',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Your cart is waiting</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;">Your order #{orderNumber} couldn''t be completed because payment didn''t go through in time. No worries — your items are still available.</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Try again</a></p>'),
  ('post_purchase',      'Post-Purchase Thank-You',
   'Sent 1 day after delivery',
   TRUE, 24, 0,
   'Hope you''re enjoying your purchase, {firstName}',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Thanks for shopping with us</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;">Just checking in on your recent order #{orderNumber}. We hope everything arrived in great shape!</p><p style="color:#555;line-height:1.6;margin:0 0 20px;">If anything''s not right, just reply to this email and we''ll sort it out.</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">View your order</a></p>'),
  ('review_reminder',    'Review Reminder',
   'Sent 7 days after delivery if no review',
   TRUE, 168, 0,
   'How was your purchase, {firstName}?',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Mind sharing a quick review?</h2><p style="color:#555;line-height:1.6;margin:0 0 20px;">Your feedback on order #{orderNumber} would mean a lot to us. Takes less than a minute.</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Leave a review</a></p>'),
  ('winback_90',         'Win-Back (90 days)',
   'Customer hasn''t ordered in 90+ days',
   TRUE, 0, 10,
   'We miss you, {firstName}',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">It''s been a while</h2><p style="color:#555;line-height:1.6;margin:0 0 16px;">Here''s {discountPercent}% off your next order to welcome you back.</p><p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 20px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Browse products</a></p>'),
  ('winback_180',        'Win-Back (180 days, dormant)',
   'Customer hasn''t ordered in 180+ days — last chance',
   TRUE, 0, 15,
   'Come back, {firstName} — {discountPercent}% off',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">We''d love to have you back</h2><p style="color:#555;line-height:1.6;margin:0 0 16px;">Here''s {discountPercent}% off, just for you. Code expires in 14 days.</p><p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 20px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Shop now</a></p>'),
  ('restock',            'Back in Stock',
   'Wishlisted product back in stock',
   TRUE, 0, 0,
   '{productName} is back in stock!',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Good news!</h2><p style="color:#555;line-height:1.6;margin:0 0 20px;"><strong>{productName}</strong> from your wishlist is back in stock. Grab it before it''s gone again.</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Buy now</a></p>'),
  ('price_drop',         'Price Drop',
   'Wishlisted product price dropped >5%',
   TRUE, 0, 0,
   'Price drop on {productName}',
   '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Price just dropped</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;"><strong>{productName}</strong> from your wishlist:</p><p style="margin:0 0 20px;"><span style="color:#999;text-decoration:line-through;">₹{oldPrice}</span> &nbsp; <strong style="color:#e07b3f;font-size:20px;">₹{newPrice}</strong></p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">View product</a></p>')
ON CONFLICT (kind) DO NOTHING;


-- ===== email_campaigns_sent: full funnel tracking =====
CREATE TABLE IF NOT EXISTS email_campaigns_sent (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_kind   VARCHAR(64) NOT NULL REFERENCES campaigns(kind) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_id    VARCHAR(128),
  message_id      VARCHAR(255),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  converted_at    TIMESTAMPTZ,
  conversion_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  unsubscribed_at TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  complained_at   TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_sent_campaign_user
  ON email_campaigns_sent (campaign_kind, user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_sent_user_recent
  ON email_campaigns_sent (user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_sent_clicked
  ON email_campaigns_sent (user_id, clicked_at DESC)
  WHERE clicked_at IS NOT NULL AND converted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sent_dedup_open
  ON email_campaigns_sent (campaign_kind, user_id, COALESCE(reference_id, ''))
  WHERE unsubscribed_at IS NULL AND bounced_at IS NULL AND complained_at IS NULL;


-- ===== users: marketing opt-out + one-click unsubscribe token =====
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_opt_out      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribe_token      UUID DEFAULT gen_random_uuid();

UPDATE users SET unsubscribe_token = gen_random_uuid() WHERE unsubscribe_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsubscribe_token
  ON users (unsubscribe_token);


-- ===== coupons: track auto-generated single-use codes =====
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS auto_generated         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generated_for_user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS generated_for_campaign VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_coupons_generated_for
  ON coupons (generated_for_user_id, generated_for_campaign)
  WHERE auto_generated = TRUE;


-- ===== wishlist snapshot for restock + price-drop detection =====
ALTER TABLE wishlist_items
  ADD COLUMN IF NOT EXISTS snapshot_price          NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS snapshot_in_stock       BOOLEAN,
  ADD COLUMN IF NOT EXISTS snapshot_taken_at       TIMESTAMPTZ;

UPDATE wishlist_items wi
SET snapshot_price = p.base_price,
    snapshot_in_stock = (p.inventory_quantity > 0),
    snapshot_taken_at = NOW()
FROM products p
WHERE p.id = wi.product_id
  AND wi.snapshot_taken_at IS NULL;


