-- Each surface (desktop web, phone web, app) gets a homepage layout of its own, replacing the single layout with a
-- per-surface show/hide toggle (config.surfaces) from 2026-11-12_homepage_single_layout.sql. Settings such as a
-- banner's shape were shared by every surface; now nothing set on one surface changes another.
--
-- Sections: each row is copied to every other surface it showed on (a missing toggle meaning shown) and the toggle is
-- dropped; a row hidden on desktop leaves desktop. Hero slides: a phone web / app homepage with no slides of its own
-- (it was showing desktop's) gets a copy of desktop's. Open homepage drafts, and the base they merge against, are
-- converted the same way. A copy's id is derived from the original id and the surface, so live rows, drafts and
-- draft bases agree on it.
--
-- Safe to run twice: sections split only while every row is still on desktop, copies insert ON CONFLICT DO NOTHING,
-- and slides copy only to a surface that has none.

CREATE OR REPLACE FUNCTION pg_temp.surface_copy_id(id text, surface text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN surface = 'web' THEN id ELSE md5(id || ':' || surface)::uuid::text END
$$;

CREATE OR REPLACE FUNCTION pg_temp.shown_on(config jsonb, surface text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (config -> 'surfaces' -> surface) IS DISTINCT FROM 'false'::jsonb
$$;

-- A draft's section rows, split per surface the same way as the live table.
CREATE OR REPLACE FUNCTION pg_temp.split_sections(rows jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(x.r ORDER BY x.ord, x.n), '[]'::jsonb)
    FROM (
      SELECT e.ord, s.n,
             e.r || jsonb_build_object('id', pg_temp.surface_copy_id(e.r ->> 'id', s.surface), 'surface', s.surface,
                                       'config', COALESCE(e.r -> 'config', '{}'::jsonb) - 'surfaces') AS r
        FROM jsonb_array_elements(rows) WITH ORDINALITY AS e(r, ord)
        CROSS JOIN (VALUES (1, 'web'), (2, 'web_mobile'), (3, 'app')) AS s(n, surface)
       WHERE COALESCE(e.r ->> 'surface', 'web') = 'web' AND pg_temp.shown_on(e.r -> 'config', s.surface)
      UNION ALL
      SELECT e.ord, 0, e.r
        FROM jsonb_array_elements(rows) WITH ORDINALITY AS e(r, ord)
       WHERE COALESCE(e.r ->> 'surface', 'web') <> 'web'
    ) x
$$;

-- Whether a draft's section rows still need splitting: none is on another surface yet.
CREATE OR REPLACE FUNCTION pg_temp.single_layout(rows jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(rows) = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) e WHERE e ->> 'surface' IN ('web_mobile', 'app'))
$$;

-- A draft's hero slides plus a copy of desktop's for every surface of a homepage that has none.
CREATE OR REPLACE FUNCTION pg_temp.fill_slides(rows jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(rows) <> 'array' THEN rows ELSE rows || COALESCE((
    SELECT jsonb_agg(e.r || jsonb_build_object('id', pg_temp.surface_copy_id(e.r ->> 'id', s.surface), 'surface', s.surface)
                     ORDER BY s.surface, e.ord)
      FROM jsonb_array_elements(rows) WITH ORDINALITY AS e(r, ord)
      CROSS JOIN (VALUES ('web_mobile'), ('app')) AS s(surface)
     WHERE COALESCE(e.r ->> 'surface', 'web') = 'web'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) o
                        WHERE o ->> 'surface' = s.surface
                          AND COALESCE(o ->> 'audience', 'store') = COALESCE(e.r ->> 'audience', 'store'))
  ), '[]'::jsonb) END
$$;

-- 1. Live sections.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM homepage_sections WHERE COALESCE(surface, 'web') <> 'web') THEN
    RETURN;
  END IF;
  INSERT INTO homepage_sections
  SELECT (jsonb_populate_record(NULL::homepage_sections,
            to_jsonb(h) || jsonb_build_object('id', pg_temp.surface_copy_id(h.id::text, s.surface), 'surface', s.surface,
                                              'config', COALESCE(h.config, '{}'::jsonb) - 'surfaces'))).*
    FROM homepage_sections h
    CROSS JOIN (VALUES ('web_mobile'), ('app')) AS s(surface)
   WHERE pg_temp.shown_on(h.config, s.surface)
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM homepage_sections WHERE NOT pg_temp.shown_on(config, 'web');
  UPDATE homepage_sections SET config = config - 'surfaces', updated_at = now() WHERE config ? 'surfaces';
END $$;

-- 2. Live hero slides.
INSERT INTO hero_slides
SELECT (jsonb_populate_record(NULL::hero_slides,
          to_jsonb(h) || jsonb_build_object('id', pg_temp.surface_copy_id(h.id::text, s.surface), 'surface', s.surface))).*
  FROM hero_slides h
  CROSS JOIN (VALUES ('web_mobile'), ('app')) AS s(surface)
 WHERE COALESCE(h.surface, 'web') = 'web'
   AND NOT EXISTS (SELECT 1 FROM hero_slides o
                    WHERE o.surface = s.surface AND COALESCE(o.audience, 'store') = COALESCE(h.audience, 'store'))
ON CONFLICT (id) DO NOTHING;

-- 3. Open drafts and their bases.
UPDATE homepage_draft_branches d
   SET sections = CASE WHEN pg_temp.single_layout(d.sections) THEN pg_temp.split_sections(d.sections) ELSE d.sections END,
       hero_slides = pg_temp.fill_slides(d.hero_slides),
       base = CASE WHEN jsonb_typeof(d.base) <> 'object' THEN d.base ELSE d.base
         || CASE WHEN pg_temp.single_layout(d.base -> 'sections')
                 THEN jsonb_build_object('sections', pg_temp.split_sections(d.base -> 'sections')) ELSE '{}'::jsonb END
         || CASE WHEN jsonb_typeof(d.base -> 'hero_slides') = 'array'
                 THEN jsonb_build_object('hero_slides', pg_temp.fill_slides(d.base -> 'hero_slides')) ELSE '{}'::jsonb END
       END;
