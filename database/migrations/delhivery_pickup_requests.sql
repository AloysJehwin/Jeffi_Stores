-- Track Delhivery pickup requests made from admin

CREATE TABLE IF NOT EXISTS delhivery_pickup_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id   VARCHAR(128),           -- Delhivery-assigned pickup request ID
  pickup_date DATE NOT NULL,
  awb_count   INTEGER NOT NULL,
  awbs        TEXT[] NOT NULL,        -- list of AWB numbers included
  raw_response JSONB,                 -- full Delhivery response
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delhivery_pickup_requests_created_at
  ON delhivery_pickup_requests (created_at DESC);
