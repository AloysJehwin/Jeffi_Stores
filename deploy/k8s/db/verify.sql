-- After the release, on jeffi_stores:
--   bash -c 'source deploy/k8s/db/lib.sh; tunnel; psql_app jeffi_stores -f deploy/k8s/db/verify.sql'
\pset footer off

\echo '== Tables this release adds (expect none listed)'
SELECT t AS missing FROM unnest(ARRAY[
  'brand_theme', 'bulk_job_items', 'bulk_jobs', 'campaign_drafts', 'document_sequences', 'document_settings', 'documents',
  'editor_sessions', 'message_events', 'messages', 'messaging_tenant_settings', 'offer_drafts', 'order_adjustment_lines',
  'order_adjustments', 'platform_invoices', 'platform_template', 'platform_template_family', 'platform_template_variant',
  'platform_template_version', 'po_drafts', 'po_receive_drafts', 'pub_short_link', 'pub_template', 'pub_template_asset',
  'pub_template_family', 'pub_template_variant', 'pub_template_version', 'short_link', 'site_control_drafts', 'sms_dlt',
  'sms_dlt_template', 'template', 'template_asset', 'template_family', 'template_variable', 'template_variant',
  'template_version', 'tenant_service_approvals', 'wa_pricing', 'waba_capacity',
  -- control plane, merged in by 20-merge-control-plane.sh
  'tenants', 'tenant_infra', 'plans', 'plan_features', 'tenant_migration_runs'
]) t WHERE to_regclass('public.' || t) IS NULL;

\echo '== Foreign keys not validated (expect none)'
SELECT conrelid::regclass AS "table", conname FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;

\echo '== Tenants'
SELECT slug, status, service_types, created_at::date AS created FROM tenants ORDER BY created_at;

\echo '== Plans (compare with the RAZORPAY_PLAN_ID_* plans in Razorpay)'
SELECT product, tier, slug, name, monthly_price_inr, is_active FROM plans ORDER BY product, tier;

\echo '== Platform message templates (50-seeds.sh)'
SELECT channel, count(*) FROM template WHERE tenant_id = '00000000-0000-0000-0000-000000000000' GROUP BY 1 ORDER BY 1;

\echo '== Latest tenant schema runs (40-tenant-fanout.sh)'
SELECT t.slug, r.git_sha, r.status, r.ran_at FROM tenant_migration_runs r JOIN tenants t ON t.id = r.tenant_id
ORDER BY r.ran_at DESC LIMIT 10;
