CREATE TABLE IF NOT EXISTS page_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id   VARCHAR(64)  NOT NULL,
  user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
  page         VARCHAR(32)  NOT NULL,  -- home | categories | category | product | cart | checkout | order_placed
  path         TEXT         NOT NULL,
  referrer     TEXT,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_events_session    ON page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_page_events_page       ON page_events(page);
CREATE INDEX IF NOT EXISTS idx_page_events_created_at ON page_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_user_id    ON page_events(user_id);
