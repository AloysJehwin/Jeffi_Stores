-- Support 2.0: data back-fill for the new support_sessions/support_messages columns, plus the
-- foreign keys the schema diff never applies. Idempotent + transactional; the columns and tables
-- themselves come from database/support.sql and database/drive.sql via the schema diff.

BEGIN;

-- Web chat wrote the customer as 'user', WhatsApp as 'customer' (the old webhook was its only
-- writer). Tag the WhatsApp rows, then use one spelling. Only on the first run: sessions without a
-- ticket number are the ones that predate this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.support_sessions WHERE ticket_number IS NULL) THEN
    UPDATE public.support_messages SET channel = 'whatsapp' WHERE channel = 'web' AND sender = 'customer';
    UPDATE public.support_messages SET sender = 'customer' WHERE sender = 'user';
    UPDATE public.support_sessions s SET channel = 'whatsapp'
     WHERE s.channel = 'web' AND s.ticket_number IS NULL
       AND EXISTS (SELECT 1 FROM public.support_messages m WHERE m.session_id = s.id AND m.channel = 'whatsapp');
  END IF;
END $$;

UPDATE public.support_sessions s SET last_message_at = COALESCE(
    (SELECT max(m.created_at) FROM public.support_messages m WHERE m.session_id = s.id), s.created_at)
 WHERE s.last_message_at IS NULL;

-- Sessions that already had an agent were handled by a human.
UPDATE public.support_sessions SET handler = 'human' WHERE admin_name IS NOT NULL AND handler = 'ai';

-- Old messages were all seen by the time this runs.
UPDATE public.support_messages SET status = 'read', read_at = COALESCE(read_at, created_at)
 WHERE status = 'sent' AND created_at < now() - interval '1 day';

UPDATE public.support_sessions
   SET ticket_number = 'SUP-' || to_char(created_at, 'YYMM') || '-' || lpad(nextval('public.support_ticket_seq')::text, 4, '0')
 WHERE ticket_number IS NULL;

DO $$
BEGIN
  IF to_regclass('public.support_message_attachments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_message_attachments_message_id_fkey') THEN
    ALTER TABLE ONLY public.support_message_attachments
      ADD CONSTRAINT support_message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.support_messages(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.support_ai_actions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ai_actions_session_id_fkey') THEN
    ALTER TABLE ONLY public.support_ai_actions
      ADD CONSTRAINT support_ai_actions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.drive_files') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drive_files_folder_id_fkey') THEN
    ALTER TABLE ONLY public.drive_files
      ADD CONSTRAINT drive_files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.drive_folders(id) ON DELETE SET NULL;
  END IF;
  IF to_regclass('public.drive_shares') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drive_shares_folder_id_fkey') THEN
    ALTER TABLE ONLY public.drive_shares
      ADD CONSTRAINT drive_shares_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.drive_folders(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.drive_shares') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drive_shares_file_id_fkey') THEN
    ALTER TABLE ONLY public.drive_shares
      ADD CONSTRAINT drive_shares_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.drive_files(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
