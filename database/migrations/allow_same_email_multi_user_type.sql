-- Allow the same email/google_id to exist as both a customer and a business user
-- by making uniqueness scoped to (email, user_type) and (google_id, user_type)

-- Drop old global unique constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_google_id_key;

-- Add composite unique constraints scoped per user_type
ALTER TABLE users ADD CONSTRAINT users_email_user_type_key UNIQUE (email, user_type);
ALTER TABLE users ADD CONSTRAINT users_google_id_user_type_key UNIQUE (google_id, user_type);
