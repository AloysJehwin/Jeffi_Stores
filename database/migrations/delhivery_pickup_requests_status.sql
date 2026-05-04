ALTER TABLE delhivery_pickup_requests
  ADD COLUMN IF NOT EXISTS pickup_status VARCHAR(32) NOT NULL DEFAULT 'pending';
