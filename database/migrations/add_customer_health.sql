-- Wave 5: Customer health score + churn prediction
-- Single row per user holding the latest computed score + breakdown.
-- History table for weekly snapshots (powers trend lines).

CREATE TABLE IF NOT EXISTS customer_health (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score              INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  recency_score      INTEGER NOT NULL DEFAULT 0,
  frequency_score    INTEGER NOT NULL DEFAULT 0,
  monetary_score     INTEGER NOT NULL DEFAULT 0,
  engagement_score   INTEGER NOT NULL DEFAULT 0,
  satisfaction_score INTEGER NOT NULL DEFAULT 70,
  churn_risk         VARCHAR(20) NOT NULL DEFAULT 'healthy'
                     CHECK (churn_risk IN ('healthy', 'rising_concern', 'high')),
  trend_delta_7d     INTEGER NOT NULL DEFAULT 0,
  trend_delta_30d    INTEGER NOT NULL DEFAULT 0,
  last_computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_health_score
  ON customer_health (score);

CREATE INDEX IF NOT EXISTS idx_customer_health_risk_score
  ON customer_health (churn_risk, score);

CREATE INDEX IF NOT EXISTS idx_customer_health_last_computed
  ON customer_health (last_computed_at);

CREATE INDEX IF NOT EXISTS idx_customer_health_trend_30d
  ON customer_health (trend_delta_30d)
  WHERE trend_delta_30d < -10;


CREATE TABLE IF NOT EXISTS customer_health_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  churn_risk  VARCHAR(20) NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_health_history_user_time
  ON customer_health_history (user_id, snapshot_at DESC);
