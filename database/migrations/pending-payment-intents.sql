-- Stores in-flight Razorpay draft-token payments so the webhook can recover
-- orders that were never committed due to network drop / page reload.
CREATE TABLE IF NOT EXISTS pending_payment_intents (
  id                 uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_order_id  text        NOT NULL UNIQUE,
  draft_token        text        NOT NULL,
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise       integer     NOT NULL,
  committed          boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppi_user_id        ON pending_payment_intents (user_id);
CREATE INDEX IF NOT EXISTS idx_ppi_committed       ON pending_payment_intents (committed) WHERE committed = false;
