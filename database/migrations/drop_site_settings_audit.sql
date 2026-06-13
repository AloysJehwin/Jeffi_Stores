-- Migration: drop site_settings audit trigger + purge existing noise rows.
--
-- The cron heartbeat (src/app/api/internal/cron-record/route.ts) upserts 4
-- rows into site_settings per job tick. With 6 jobs running on schedule that
-- bloated admin_audit_log to 40k+ rows locally and 90k+ in live, all of them
-- the same useless 'site_settings.update' entry. This migration:
--   1. Drops trg_audit_site_settings.
--   2. Purges historical entity_type='site_settings' rows from admin_audit_log.
--
-- Idempotent — safe to re-run.

BEGIN;

DROP TRIGGER IF EXISTS trg_audit_site_settings ON site_settings;

DELETE FROM admin_audit_log WHERE entity_type = 'site_settings';

INSERT INTO schema_migrations (filename)
VALUES ('drop_site_settings_audit.sql')
ON CONFLICT DO NOTHING;

COMMIT;
