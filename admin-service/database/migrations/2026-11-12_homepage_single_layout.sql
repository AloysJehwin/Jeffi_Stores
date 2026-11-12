-- One homepage layout per page and homepage, with a per-surface show/hide toggle on each section
-- (config.surfaces = { web, web_mobile, app }), instead of a separate list per surface.
--
-- Before: phone browsers / the app showed their own rows (surface = web_mobile / app) when they had
-- any, else the desktop rows. After: every row is surface = 'web'; a row the mobile web or app layout
-- had of its own shows on that surface alone, a desktop row is hidden on a surface that had its own
-- layout, and a copy identical to a desktop row merges into it (shown on both). Hero slides keep a
-- set per surface. Idempotent: once no row has another surface, every step matches nothing.

-- 1. A surface that had its own layout hides the desktop rows there.
UPDATE homepage_sections w
   SET config = jsonb_set(COALESCE(w.config, '{}'::jsonb), '{surfaces}',
                          COALESCE(w.config -> 'surfaces', '{}'::jsonb) || jsonb_build_object(o.surface, false))
  FROM (SELECT DISTINCT audience, page, surface FROM homepage_sections WHERE surface <> 'web') o
 WHERE w.surface = 'web' AND w.audience = o.audience AND w.page = o.page
   AND COALESCE((w.config -> 'surfaces' ->> o.surface)::boolean, true) IS DISTINCT FROM false;

-- 2. A surface row identical to a desktop row merges into it: the desktop row shows there too.
WITH dupes AS (
  SELECT a.id AS dupe_id, w.id AS web_id, a.surface
    FROM homepage_sections a
    JOIN homepage_sections w
      ON w.surface = 'web' AND w.audience = a.audience AND w.page = a.page AND w.type = a.type
     AND w.title IS NOT DISTINCT FROM a.title AND w.subtitle IS NOT DISTINCT FROM a.subtitle
     AND w.eyebrow IS NOT DISTINCT FROM a.eyebrow AND w.cta_label IS NOT DISTINCT FROM a.cta_label
     AND w.cta_url IS NOT DISTINCT FROM a.cta_url AND w.is_active = a.is_active
     AND w.starts_at IS NOT DISTINCT FROM a.starts_at AND w.ends_at IS NOT DISTINCT FROM a.ends_at
     AND (COALESCE(w.config, '{}'::jsonb) - 'surfaces') = (COALESCE(a.config, '{}'::jsonb) - 'surfaces')
   WHERE a.surface <> 'web'
),
merged AS (
  UPDATE homepage_sections w
     SET config = jsonb_set(COALESCE(w.config, '{}'::jsonb), '{surfaces}',
                            COALESCE(w.config -> 'surfaces', '{}'::jsonb) || jsonb_build_object(d.surface, true))
    FROM dupes d
   WHERE w.id = d.web_id
  RETURNING d.dupe_id
)
DELETE FROM homepage_sections WHERE id IN (SELECT dupe_id FROM merged);

-- 3. The surface's remaining rows join the single layout after the desktop rows, shown on that surface alone.
WITH moved AS (
  SELECT a.id, a.surface,
         COALESCE((SELECT MAX(display_order) FROM homepage_sections w
                    WHERE w.surface = 'web' AND w.audience = a.audience AND w.page = a.page), -1)
         + ROW_NUMBER() OVER (PARTITION BY a.audience, a.page ORDER BY a.surface, a.display_order, a.created_at) AS display_order
    FROM homepage_sections a
   WHERE a.surface <> 'web'
)
UPDATE homepage_sections s
   SET surface = 'web',
       display_order = m.display_order,
       config = jsonb_set(COALESCE(s.config, '{}'::jsonb), '{surfaces}',
                          jsonb_build_object('web', false, 'web_mobile', m.surface = 'web_mobile', 'app', m.surface = 'app')),
       updated_at = now()
  FROM moved m
 WHERE s.id = m.id;
