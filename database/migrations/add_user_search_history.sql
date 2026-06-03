CREATE TABLE IF NOT EXISTS user_search_history (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_search_history_user_created ON user_search_history(user_id, created_at DESC);
-- migrated
