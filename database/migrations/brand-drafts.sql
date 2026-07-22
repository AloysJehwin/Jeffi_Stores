CREATE TABLE IF NOT EXISTS brand_drafts (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
