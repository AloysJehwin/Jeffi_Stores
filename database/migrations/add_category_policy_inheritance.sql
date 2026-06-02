-- Make category policy columns nullable so NULL means "inherit from parent category"
-- Main categories keep explicit values; sub-categories default to NULL (inherited)
ALTER TABLE categories
  ALTER COLUMN return_allowed          DROP NOT NULL,
  ALTER COLUMN return_window_days      DROP NOT NULL,
  ALTER COLUMN replacement_allowed     DROP NOT NULL,
  ALTER COLUMN replacement_window_days DROP NOT NULL;

-- Reset all existing sub-categories to NULL so they inherit from their parent
UPDATE categories SET
  return_allowed = NULL,
  return_window_days = NULL,
  replacement_allowed = NULL,
  replacement_window_days = NULL
WHERE parent_category_id IS NOT NULL;


