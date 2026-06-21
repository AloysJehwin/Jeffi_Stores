-- campaign_send_counts: running total of sends per (campaign_kind, user_id)
-- Updated by recordSent() on every send. Allows O(1) count lookups.
CREATE TABLE IF NOT EXISTS campaign_send_counts (
  campaign_kind  VARCHAR(64)  NOT NULL REFERENCES campaigns(kind) ON DELETE CASCADE,
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  send_count     INTEGER      NOT NULL DEFAULT 0,
  last_sent_at   TIMESTAMPTZ,
  PRIMARY KEY (campaign_kind, user_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_send_counts_user ON campaign_send_counts (user_id);

-- Seed from existing sends
INSERT INTO campaign_send_counts (campaign_kind, user_id, send_count, last_sent_at)
SELECT
  campaign_kind,
  user_id,
  COUNT(*)::integer AS send_count,
  MAX(sent_at) AS last_sent_at
FROM email_campaigns_sent
GROUP BY campaign_kind, user_id
ON CONFLICT (campaign_kind, user_id) DO UPDATE
  SET send_count   = EXCLUDED.send_count,
      last_sent_at = EXCLUDED.last_sent_at;

-- Store the lookbackDays override explicitly for abandoned_cart
UPDATE campaigns
SET parameters = parameters || '{"lookbackDays": 30}'::jsonb
WHERE kind = 'abandoned_cart';
