-- site_studio_sessions: a Showcase's studio is now per site. The schema diff adds site_id and the unique index on
-- (owner_id, product, site_id); this drops the old one-per-owner-and-product key and points each owner's existing
-- Showcase studio at their newest site (the one the builder edited until now). Flagship only. Safe to run twice.
ALTER TABLE public.site_studio_sessions DROP CONSTRAINT IF EXISTS site_studio_sessions_owner_product_key;
UPDATE public.site_studio_sessions s
   SET site_id = (SELECT w.id FROM public.showcase_sites w WHERE w.owner_id = s.owner_id ORDER BY w.created_at DESC LIMIT 1)
 WHERE s.product = 'showcase' AND s.site_id IS NULL;
