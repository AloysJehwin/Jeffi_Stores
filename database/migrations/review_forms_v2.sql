ALTER TABLE review_form_submissions
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}';

DROP INDEX IF EXISTS review_form_submissions_phone_form;
CREATE UNIQUE INDEX IF NOT EXISTS review_form_submissions_email_form
  ON review_form_submissions(form_id, email);

ALTER TABLE review_forms
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]';
