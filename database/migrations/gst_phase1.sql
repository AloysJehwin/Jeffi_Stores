ALTER TABLE orders ADD COLUMN IF NOT EXISTS irn VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS irn_ack_no VARCHAR(32);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS irn_ack_dt TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS signed_qr TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS irn_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS irn_cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS eway_bill_no VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS eway_bill_date TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS eway_bill_valid_upto TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_status VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_irn ON orders (irn) WHERE irn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_link_id ON orders (payment_link_id) WHERE payment_link_id IS NOT NULL;

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS state_code VARCHAR(3);

INSERT INTO site_settings (key, value) VALUES
  ('business_city', ''),
  ('business_pincode', '')
ON CONFLICT (key) DO NOTHING;
