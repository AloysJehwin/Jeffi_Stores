-- Catalog AI enrichment: store LLM-rewritten descriptions + extracted use-case tags.
-- Promotion is gated by admin approval through product_ai_enrichment_log.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ai_description text,
  ADD COLUMN IF NOT EXISTS ai_use_cases text[],
  ADD COLUMN IF NOT EXISTS ai_enriched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_products_ai_use_cases
  ON products USING gin (ai_use_cases);

CREATE TABLE IF NOT EXISTS product_ai_enrichment_log (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_name     text NOT NULL,
  source_desc     text,
  ai_description  text NOT NULL,
  ai_use_cases    text[] NOT NULL DEFAULT '{}',
  model           text NOT NULL,
  prompt_tokens   integer,
  completion_tokens integer,
  status          text NOT NULL DEFAULT 'proposed',
  proposed_at     timestamptz NOT NULL DEFAULT NOW(),
  decided_at      timestamptz,
  decided_by_admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  promoted_at     timestamptz,
  re_embedded_at  timestamptz,
  error           text,
  CONSTRAINT product_ai_enrichment_log_status_chk
    CHECK (status IN ('proposed','approved','rejected','failed'))
);

CREATE INDEX IF NOT EXISTS idx_pae_log_product_id
  ON product_ai_enrichment_log (product_id);
CREATE INDEX IF NOT EXISTS idx_pae_log_status
  ON product_ai_enrichment_log (status);
CREATE INDEX IF NOT EXISTS idx_pae_log_proposed_at
  ON product_ai_enrichment_log (proposed_at DESC);

