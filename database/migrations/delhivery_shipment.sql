-- Delhivery shipment tracking: add AWB and update shipping_amount to be stored on order create

-- AWB number returned by Delhivery after shipment registration
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS awb_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS delhivery_shipment_id VARCHAR(128);

-- shipping_amount already exists in schema (DECIMAL 12,2), just ensure it's there
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_amount DECIMAL(12, 2) DEFAULT 0;
