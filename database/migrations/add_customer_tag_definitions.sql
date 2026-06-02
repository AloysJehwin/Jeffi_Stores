-- Predefined customer tags that admins can assign to customers
CREATE TABLE IF NOT EXISTS customer_tag_definitions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag        varchar(60) NOT NULL UNIQUE,
  color      varchar(20) NOT NULL DEFAULT 'accent',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_tag_defs_tag ON customer_tag_definitions(tag);

-- Seed some sensible defaults
INSERT INTO customer_tag_definitions (tag, color, sort_order) VALUES
  ('wholesale-prospect', 'blue',    10),
  ('vip',               'purple',  20),
  ('retail',            'green',   30),
  ('b2b',               'orange',  40),
  ('high-value',        'gold',    50),
  ('at-risk',           'red',     60),
  ('dormant',           'gray',    70),
  ('new-customer',      'teal',    80)
ON CONFLICT (tag) DO NOTHING;
-- migrated
