-- The homepage's single shared draft (homepage_drafts, one row) becomes the first of several
-- (homepage_draft_branches, created by the schema pipeline). The row moves over with base NULL
-- (publish then treats live as its base, as before), its lock and open editor session follow it
-- from the nil uuid to the new id, and the old table goes (the schema diff never drops tables).

DO $$
DECLARE
  nil constant uuid := '00000000-0000-0000-0000-000000000000';
  new_id uuid;
BEGIN
  IF to_regclass('public.homepage_drafts') IS NULL OR to_regclass('public.homepage_draft_branches') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.homepage_drafts) THEN
    new_id := gen_random_uuid();
    INSERT INTO public.homepage_draft_branches
      (id, homepage_id, author_admin_id, base, base_revision, sections, hero_slides, updated_by, created_at, updated_at)
    SELECT new_id, nil,
           COALESCE((SELECT owner_admin_id FROM public.draft_locks
                      WHERE resource_type = 'homepage' AND resource_id = nil AND closed_at IS NULL), d.updated_by),
           NULL, 0, d.sections, d.hero_slides, d.updated_by, d.created_at, d.updated_at
      FROM public.homepage_drafts d;

    UPDATE public.draft_locks SET resource_id = new_id
     WHERE resource_type = 'homepage' AND resource_id = nil AND closed_at IS NULL;
    IF to_regclass('public.editor_sessions') IS NOT NULL THEN
      UPDATE public.editor_sessions SET resource_id = new_id
       WHERE resource_type = 'homepage' AND resource_id = nil AND closed_at IS NULL;
    END IF;
  END IF;

  -- A lock left on the nil uuid has no draft behind it any more.
  UPDATE public.draft_locks SET closed_at = now(), closed_reason = 'orphaned', updated_at = now()
   WHERE resource_type = 'homepage' AND resource_id = nil AND closed_at IS NULL;

  DROP TABLE public.homepage_drafts;
END $$;
