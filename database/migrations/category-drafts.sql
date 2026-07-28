-- Category draft system
-- Stores pending edits to categories before they go live
-- Same pattern as product_drafts

CREATE TABLE IF NOT EXISTS category_drafts (
  category_id uuid PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
