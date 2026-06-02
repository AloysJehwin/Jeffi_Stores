ALTER TABLE quotations ADD COLUMN IF NOT EXISTS buyer_phone VARCHAR(20);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS buyer_pincode VARCHAR(10);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS buyer_email TEXT;
-- migrated
