-- Rehearsal safe mode, database half. Run ONLY against the restored COPY on the Azure Postgres (restore-dump.sh and
-- rehearse.sh do, as app_user, and never reach RDS). Makes the copy unable to contact customers, owners, payment
-- providers or marketplaces. Idempotent. A table or column that does not exist is skipped with a notice; any other
-- error stops the run. Each line prints how many rows it changed.
CREATE FUNCTION pg_temp.scrub(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'safe-mode: % -> % row(s)', label, n;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RAISE NOTICE 'safe-mode: % -> skipped (%)', label, SQLERRM;
END $$;

-- 1. Channel and payment switches in site_settings (the platform's own store; each store keeps its own database on
--    AWS and is not part of this copy). Missing rows are inserted off, so no env default can turn them on.
SELECT pg_temp.scrub('insert flag ' || k, format(
  $f$INSERT INTO site_settings (key, value) SELECT %L, 'false' WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE key = %L)$f$, k, k))
  FROM unnest(ARRAY['feature_sms_enabled','feature_whatsapp_enabled','feature_push_enabled','feature_marketing_push_enabled',
    'feature_birthday_enabled','feature_agent_whatsapp_enabled','feature_razorpay_enabled','feature_upi_enabled',
    'feature_subscriptions_enabled','feature_reply_auto_apply']) AS k;
SELECT pg_temp.scrub('flags off', $s$UPDATE site_settings SET value = 'false', updated_at = now()
  WHERE key = ANY(ARRAY['feature_sms_enabled','feature_whatsapp_enabled','feature_push_enabled','feature_marketing_push_enabled',
    'feature_birthday_enabled','feature_agent_whatsapp_enabled','feature_razorpay_enabled','feature_upi_enabled',
    'feature_subscriptions_enabled','feature_reply_auto_apply']) AND value IS DISTINCT FROM 'false'$s$);

-- 2. Credentials and endpoints held in settings rows (any key that looks like one; the feature_ flags are left to step 1).
SELECT pg_temp.scrub('site_settings secrets and webhooks blanked', $s$UPDATE site_settings SET value = NULL, updated_at = now()
  WHERE value IS NOT NULL AND key !~ '^feature_'
    AND key ~* '(token|secret|api[_-]?key|apikey|_key$|key_id|webhook|password|passwd|private[_-]?key|credential|access[_-]?key|refresh|callback)'$s$);

-- 3. Connected third-party accounts: provider credentials, social tokens, device push tokens, queued pushes.
SELECT pg_temp.scrub('tenant_integration_credentials revoked', $s$UPDATE tenant_integration_credentials SET config_enc = '', status = 'revoked', updated_at = now()$s$);
SELECT pg_temp.scrub('tenant_social_accounts revoked', $s$UPDATE tenant_social_accounts SET access_token_enc = '', status = 'revoked', updated_at = now()$s$);
SELECT pg_temp.scrub('scheduled_social_posts cancelled', $s$UPDATE scheduled_social_posts SET status = 'failed' WHERE status IN ('pending', 'publishing')$s$);
SELECT pg_temp.scrub('push_devices deleted', $s$DELETE FROM push_devices$s$);
SELECT pg_temp.scrub('push_queue deleted', $s$DELETE FROM push_queue$s$);

-- 4. Campaigns, queued sends and outreach.
SELECT pg_temp.scrub('campaigns disabled', $s$UPDATE campaigns SET enabled = false WHERE enabled$s$);
SELECT pg_temp.scrub('email_campaigns back to draft', $s$UPDATE email_campaigns SET status = 'draft' WHERE status IN ('scheduled', 'sending', 'active', 'queued')$s$);
SELECT pg_temp.scrub('deferred campaign sends skipped', $s$UPDATE email_campaign_logs SET status = 'skipped' WHERE status = 'deferred'$s$);
SELECT pg_temp.scrub('queued messages skipped', $s$UPDATE messages SET status = 'skipped' WHERE status = 'queued'$s$);
SELECT pg_temp.scrub('bulk_jobs cancelled', $s$UPDATE bulk_jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')$s$);
SELECT pg_temp.scrub('bulk_job_items skipped', $s$UPDATE bulk_job_items SET status = 'skipped' WHERE status = 'pending'$s$);
SELECT pg_temp.scrub('outreach programs paused', $s$UPDATE outreach_program_state SET enabled = false, updated_at = now() WHERE enabled$s$);

-- 5. Provisioning jobs and billing that would drive AWS or Razorpay from the copy.
SELECT pg_temp.scrub('in-flight provisioning jobs failed', $s$UPDATE provisioning_jobs SET status = 'failed', last_error = 'rehearsal copy: not resumed'
  WHERE status IN ('pending', 'running')$s$);
