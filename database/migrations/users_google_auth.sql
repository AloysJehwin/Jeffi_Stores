ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'email';
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
