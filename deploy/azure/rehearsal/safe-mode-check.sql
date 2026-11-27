-- Prints the number of safe-mode violations in the Azure copy (0 = safe). Read-only. Mirrors safe-mode.sql: every
-- outbound switch it turns off and every queue it drains is counted here.
SELECT
  (SELECT count(*) FROM site_settings WHERE key IN ('feature_sms_enabled', 'feature_whatsapp_enabled', 'feature_push_enabled',
     'feature_marketing_push_enabled', 'feature_birthday_enabled', 'feature_agent_whatsapp_enabled', 'feature_razorpay_enabled',
     'feature_upi_enabled', 'feature_subscriptions_enabled', 'feature_reply_auto_apply')
     AND lower(coalesce(value, '')) IN ('true', '1', 'on', 'yes'))
  + (SELECT count(*) FROM campaigns WHERE enabled)
  + (SELECT count(*) FROM email_campaigns WHERE status IN ('scheduled', 'sending', 'active', 'queued'))
  + (SELECT count(*) FROM email_campaign_logs WHERE status = 'deferred')
  + (SELECT count(*) FROM messages WHERE status = 'queued')
  + (SELECT count(*) FROM bulk_jobs WHERE status IN ('queued', 'running'))
  + (SELECT count(*) FROM bulk_job_items WHERE status = 'pending')
  + (SELECT count(*) FROM scheduled_social_posts WHERE status IN ('pending', 'publishing'))
  + (SELECT count(*) FROM push_queue)
  + (SELECT count(*) FROM outreach_program_state WHERE enabled)
  + (SELECT count(*) FROM tenant_integration_credentials WHERE status <> 'revoked')
  + (SELECT count(*) FROM tenant_social_accounts WHERE status <> 'revoked')
  + (SELECT count(*) FROM provisioning_jobs WHERE status IN ('pending', 'running'));
