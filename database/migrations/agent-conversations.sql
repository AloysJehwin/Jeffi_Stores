-- One admin_agent_conversations row per existing chat (owner = whoever wrote it, title = its first
-- question). Idempotent; tenant DBs without the table skip it.
DO $$
BEGIN
  IF to_regclass('public.admin_agent_conversations') IS NULL THEN RETURN; END IF;
  INSERT INTO public.admin_agent_conversations (id, admin_id, title, created_at, updated_at, last_message_at)
  SELECT m.conversation_id,
         (array_agg(m.admin_id ORDER BY m.created_at))[1],
         left((array_agg(m.content ORDER BY m.created_at) FILTER (WHERE m.role = 'user' AND m.content <> ''))[1], 160),
         min(m.created_at), max(m.created_at), max(m.created_at)
    FROM public.admin_agent_messages m
   WHERE EXISTS (SELECT 1 FROM public.admins a WHERE a.id = m.admin_id)
   GROUP BY m.conversation_id
  ON CONFLICT (id) DO NOTHING;
END $$;
