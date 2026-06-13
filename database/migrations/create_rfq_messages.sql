CREATE TABLE IF NOT EXISTS rfq_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id      UUID NOT NULL REFERENCES business_rfqs(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('admin', 'customer')),
  message     TEXT NOT NULL,
  counter_items JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_messages_rfq_id ON rfq_messages(rfq_id);

INSERT INTO schema_migrations (filename) VALUES ('create_rfq_messages.sql') ON CONFLICT DO NOTHING;
