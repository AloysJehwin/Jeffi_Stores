CREATE TABLE IF NOT EXISTS review_form_drafts (
  form_id uuid PRIMARY KEY REFERENCES review_forms(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
