-- Customer replies: the foreign keys the schema diff never applies. Idempotent + transactional; the
-- tables and columns come from database/replies.sql and database/support.sql via the schema diff.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.reply_context_sends') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reply_context_sends_context_id_fkey') THEN
    ALTER TABLE ONLY public.reply_context_sends
      ADD CONSTRAINT reply_context_sends_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.reply_contexts(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.reply_contexts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reply_contexts_user_id_fkey') THEN
    ALTER TABLE ONLY public.reply_contexts
      ADD CONSTRAINT reply_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
