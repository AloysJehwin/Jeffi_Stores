-- Add requested_price to business_rfq_items so users can specify their target price per item
ALTER TABLE business_rfq_items ADD COLUMN IF NOT EXISTS requested_price numeric(12,2);

-- Add admin_note to business_rfqs for admin response when approving/rejecting
ALTER TABLE business_rfqs ADD COLUMN IF NOT EXISTS admin_note text;
ALTER TABLE business_rfqs ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES admins(id);
ALTER TABLE business_rfqs ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
