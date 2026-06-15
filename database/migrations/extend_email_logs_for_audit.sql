-- Mail audit: log every outbound email with its content so admins can see
-- what was actually sent (transactional + automation + business + campaigns).
--
-- Extends the pre-existing `email_logs` table (which had no writers) with
-- the columns we need to render the audit UI: body, status, error, kind,
-- entity link, cc/bcc.

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS from_email   varchar(255),
  ADD COLUMN IF NOT EXISTS cc           text,
  ADD COLUMN IF NOT EXISTS bcc          text,
  ADD COLUMN IF NOT EXISTS body_html    text,
  ADD COLUMN IF NOT EXISTS body_text    text,
  ADD COLUMN IF NOT EXISTS kind         varchar(64),
  ADD COLUMN IF NOT EXISTS entity_type  varchar(64),
  ADD COLUMN IF NOT EXISTS entity_id    varchar(128),
  ADD COLUMN IF NOT EXISTS error        text,
  ADD COLUMN IF NOT EXISTS message_id   varchar(255);

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at        ON public.email_logs (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_kind           ON public.email_logs (kind);
CREATE INDEX IF NOT EXISTS idx_email_logs_entity         ON public.email_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status_sent_at ON public.email_logs (status, sent_at DESC);

INSERT INTO schema_migrations (filename, applied_at) VALUES ('extend_email_logs_for_audit.sql', now())
ON CONFLICT (filename) DO NOTHING;
