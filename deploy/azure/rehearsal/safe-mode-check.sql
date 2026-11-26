-- Prints the number of safe-mode violations in the Azure copy (0 = safe). Read-only.
SELECT
  (SELECT count(*) FROM site_settings WHERE key IN ('feature_sms_enabled', 'feature_whatsapp_enabled', 'feature_push_enabled',
     'feature_marketing_push_enabled', 'feature_razorpay_enabled', 'feature_subscriptions_enabled')
     AND lower(coalesce(value, '')) IN ('true', '1', 'on', 'yes'))
  + (SELECT count(*) FROM campaigns WHERE enabled)
  + (SELECT count(*) FROM outreach_program_state WHERE enabled)
  + (SELECT count(*) FROM tenant_integration_credentials WHERE status <> 'revoked')
  + (SELECT count(*) FROM tenant_social_accounts WHERE status <> 'revoked')
  + (SELECT count(*) FROM provisioning_jobs WHERE status IN ('pending', 'running'));
