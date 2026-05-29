CREATE TABLE IF NOT EXISTS customer_tags (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag         varchar(60) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES admins(id) ON DELETE SET NULL,
  UNIQUE (user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_user ON customer_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag  ON customer_tags(tag);

CREATE TABLE IF NOT EXISTS customer_notes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  admin_id    uuid REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_user_created ON customer_notes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS search_logs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  query         text NOT NULL,
  results_count int  NOT NULL DEFAULT 0,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id    varchar(64),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_created     ON search_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_no_results  ON search_logs(query) WHERE results_count = 0;
CREATE INDEX IF NOT EXISTS idx_search_logs_user        ON search_logs(user_id);
