ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS consignee_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS consignee_pincode VARCHAR(10);
