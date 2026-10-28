-- Several drafts per entity (docs/plans/MULTI_DRAFT_PLAN.md). The schema pipeline adds the new
-- columns (id, author_admin_id, title, base, base_revision); this moves each draft table's primary
-- key from the entity id to the draft id, and re-points the draft's lock, editor sessions and
-- author from the entity id to the draft id. Runs once per table (skipped when the key is already id).

DO $$
DECLARE
  t text;
  k text;
  rt text;
BEGIN
  FOR t, k, rt IN VALUES
    ('product_drafts', 'product_id', 'product'),
    ('brand_drafts', 'brand_id', 'brand'),
    ('category_drafts', 'category_id', 'category'),
    ('coupon_drafts', 'coupon_id', 'coupon'),
    ('review_form_drafts', 'form_id', 'review_form'),
    ('supplier_drafts', 'supplier_id', 'supplier'),
    ('offer_drafts', 'offer_id', 'offer')
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.conrelid = ('public.' || t)::regclass AND c.contype = 'p' AND a.attname = k
    ) THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, t || '_pkey');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id)', t, t || '_pkey');

    IF to_regclass('public.draft_locks') IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I d SET author_admin_id = l.owner_admin_id FROM public.draft_locks l
          WHERE d.author_admin_id IS NULL AND l.resource_type = %L AND l.resource_id = d.%I', t, rt, k);
      EXECUTE format(
        'UPDATE public.draft_locks l SET resource_id = d.id FROM public.%I d
          WHERE l.resource_type = %L AND l.resource_id = d.%I', t, rt, k);
    END IF;
    IF to_regclass('public.editor_sessions') IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.editor_sessions s SET resource_id = d.id FROM public.%I d
          WHERE s.resource_type = %L AND s.resource_id = d.%I AND s.closed_at IS NULL', t, rt, k);
    END IF;
  END LOOP;
END $$;
