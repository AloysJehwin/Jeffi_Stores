ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS razorpay_qr_id       TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_qr_image_url TEXT,
  ADD COLUMN IF NOT EXISTS needs_delivery        BOOLEAN NOT NULL DEFAULT FALSE;
