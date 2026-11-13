-- One-off for store tenant databases provisioned before the tenant schema set (2026-11-13): drop the flagship-only
-- tables they still carry (platform-only/ and control-plane/ in scripts/db-files.mjs). HELD: nothing loads this
-- folder. After a live inventory (bash deploy/k8s/db/40-tenant-fanout.sh live --report) and a backup, move it to
-- controller-service/database/migrations/ in the release that should carry it; the tenant files fan-out then runs it on
-- every store (deploy/k8s/README.md, Releasing). The flagship returns early (its control plane is seeded); a table
-- with rows is kept and named in a WARNING, and stays in the report for a person to look at. Safe to run twice.
DO $$
DECLARE
  t text;
  n bigint;
  flagship_only text[] := ARRAY[
    -- platform-only
    'ai_cache', 'ai_prompt_presets', 'bulk_job_items', 'bulk_jobs', 'message_events', 'messages',
    'messaging_tenant_settings', 'platform_invoices', 'platform_template', 'platform_template_family', 'platform_template_variant', 'platform_template_version',
    'pub_short_link', 'pub_template', 'pub_template_asset', 'pub_template_family', 'pub_template_variant', 'pub_template_version',
    'short_link', 'tenant_service_approvals', 'wa_pricing', 'waba_capacity',
    -- control-plane
    'admin_api_tokens', 'admin_mobiles', 'ai_price_list', 'ai_provider_identities', 'api_key_usage_daily', 'api_keys',
    'compute_prices', 'import_jobs', 'linked_account_settlements', 'onboarding_drafts', 'owner_tenants', 'owners',
    'plan_features', 'plans', 'platform_infra', 'platform_provider_settings', 'platform_setup_progress', 'portal_certs',
    'provisioning_jobs', 'provisioning_step_events', 'razorpay_downtimes', 'razorpay_subscription_index', 'scheduled_social_posts', 'settlement_ledger',
    'shared_db_hosts', 'sheet_product_links', 'social_autopost_rules', 'social_autopost_seen', 'social_inbox', 'social_post_insights',
    'social_templates', 'tenant_admin_certs', 'tenant_archives', 'tenant_bank_accounts', 'tenant_ca', 'tenant_compute',
    'tenant_compute_periods', 'tenant_custom_domains', 'tenant_infra', 'tenant_integration_credentials', 'tenant_kyc', 'tenant_messaging_senders',
    'tenant_metrics_daily', 'tenant_migration_runs', 'tenant_social_accounts', 'tenant_transactions', 'tenant_wallets', 'tenants',
    'wallet_ledger'
  ];
BEGIN
  -- Never by database name (jeffi_stores live, jeffi_production_ready locally): a store's copy of plans is empty.
  IF to_regclass('public.plans') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.plans' INTO n;
    IF n > 0 THEN
      RAISE NOTICE 'flagship database: nothing dropped';
      RETURN;
    END IF;
  END IF;
  FOREACH t IN ARRAY flagship_only LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN
      RAISE WARNING 'kept public.% (% rows): look before dropping it', t, n;
      CONTINUE;
    END IF;
    -- CASCADE drops only constraints pointing at it: no tenant-set table references a flagship-only one.
    EXECUTE format('DROP TABLE public.%I CASCADE', t);
  END LOOP;
END $$;
