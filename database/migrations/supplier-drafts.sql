CREATE TABLE IF NOT EXISTS supplier_drafts (
  supplier_id uuid PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
