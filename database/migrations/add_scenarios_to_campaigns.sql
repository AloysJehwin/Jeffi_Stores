-- Decouple scenarios (reusable trigger logic) from campaigns (template + coupon + params).
-- One scenario can back many campaigns. Existing 8 campaign rows are auto-linked to
-- the scenario sharing their kind so behavior is unchanged.

-- ===== scenarios: trigger-logic registry =====
CREATE TABLE IF NOT EXISTS scenarios (
  kind               VARCHAR(64) PRIMARY KEY,
  name               VARCHAR(128) NOT NULL,
  description        TEXT,
  default_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO scenarios (kind, name, description, default_parameters) VALUES
  ('abandoned_cart',     'Abandoned Cart',
   'Customer left items in cart without checking out',
   '{"lookbackDays":7,"sendCooldownDays":7,"maxRecipientsPerSweep":50,"maxItemsPerEmail":5}'::jsonb),

  ('abandoned_checkout', 'Abandoned Checkout',
   'Order auto-cancelled after the 10-minute payment window expired',
   '{"minMinutesAfterCancel":15,"maxRecipientsPerSweep":50}'::jsonb),

  ('post_purchase',      'Post-Purchase Thank-You',
   'Sent N hours after delivery',
   '{"lookbackDays":7,"maxRecipientsPerSweep":50}'::jsonb),

  ('review_reminder',    'Review Reminder',
   'Sent N hours after delivery if no review left',
   '{"lookbackDays":30,"maxRecipientsPerSweep":50}'::jsonb),

  ('winback_90',         'Win-Back (90 days)',
   'Customer hasn''t ordered in 90+ days',
   '{"minDaysSinceOrder":60,"maxDaysSinceOrder":150,"healthScoreMin":25,"healthScoreMax":50,"sendCooldownDays":60,"maxRecipientsPerSweep":50}'::jsonb),

  ('winback_180',        'Win-Back (180 days, dormant)',
   'Customer hasn''t ordered in 180+ days — last chance',
   '{"minDaysSinceOrder":150,"maxDaysSinceOrder":365,"healthScoreMin":0,"healthScoreMax":25,"sendCooldownDays":60,"maxRecipientsPerSweep":50}'::jsonb),

  ('restock',            'Back in Stock',
   'Wishlisted product back in stock',
   '{"maxWatchesPerSweep":100}'::jsonb),

  ('price_drop',         'Price Drop',
   'Wishlisted product price dropped',
   '{"priceDropThresholdPct":5,"maxWatchesPerSweep":100}'::jsonb)
ON CONFLICT (kind) DO NOTHING;


-- ===== campaigns: link to scenario + per-campaign parameter overrides =====
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS scenario_kind VARCHAR(64) REFERENCES scenarios(kind) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parameters    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: existing campaigns each match a scenario by sharing the same kind.
UPDATE campaigns SET scenario_kind = kind
WHERE scenario_kind IS NULL
  AND kind IN (SELECT kind FROM scenarios);

CREATE INDEX IF NOT EXISTS idx_campaigns_scenario_kind ON campaigns (scenario_kind);
