-- controller-service: constraints (control-plane set). Load order comes from scripts/db-files.mjs.

-- ── Constraints ──
ALTER TABLE ONLY public.plans          ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_features  ADD CONSTRAINT plan_features_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_infra   ADD CONSTRAINT tenant_infra_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plans          ADD CONSTRAINT plans_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_custom_domain_key UNIQUE (custom_domain);
ALTER TABLE ONLY public.plan_features  ADD CONSTRAINT plan_features_plan_scope_key UNIQUE (plan_id, scope_key);
ALTER TABLE ONLY public.tenant_infra   ADD CONSTRAINT tenant_infra_tenant_id_key UNIQUE (tenant_id);

ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('provisioning','active','suspended','terminated','pending_approval','awaiting_payment','rejected'));
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_subscription_status_check
    CHECK (subscription_status IN ('created','authenticated','active','halted','cancelled','completed','expired'));
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_billing_interval_check
    CHECK (billing_interval IN ('monthly','yearly'));
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_store_request_check
    CHECK (store_request IN ('pending_approval','awaiting_payment','provisioning'));
ALTER TABLE ONLY public.plans          ADD CONSTRAINT plans_tier_check CHECK (tier BETWEEN 0 AND 5); -- 0 = services-only plan

ALTER TABLE ONLY public.tenant_transactions  ADD CONSTRAINT tenant_transactions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_transactions  ADD CONSTRAINT tenant_transactions_tenant_order_key UNIQUE (tenant_id, order_ref);
ALTER TABLE ONLY public.settlement_ledger    ADD CONSTRAINT settlement_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_metrics_daily ADD CONSTRAINT tenant_metrics_daily_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_metrics_daily ADD CONSTRAINT tenant_metrics_daily_date_key UNIQUE (metric_date);

ALTER TABLE ONLY public.tenant_wallets ADD CONSTRAINT tenant_wallets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_wallets ADD CONSTRAINT tenant_wallets_tenant_id_key UNIQUE (tenant_id);
ALTER TABLE ONLY public.wallet_ledger  ADD CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wallet_ledger  ADD CONSTRAINT wallet_ledger_entry_type_check
    CHECK (entry_type IN ('recharge','debit','adjustment'));

ALTER TABLE ONLY public.provisioning_jobs     ADD CONSTRAINT provisioning_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_migration_runs ADD CONSTRAINT tenant_migration_runs_pkey PRIMARY KEY (id);

-- No tenants FK on the tables the flagship writes under the platform id (00000000-…, which has no
-- tenants row): import_jobs, sheet_product_links, tenant_social_accounts, tenant_integration_credentials,
-- razorpay_subscription_index, ai_provider_identities. purgeTenant deletes a store's rows from them.
ALTER TABLE ONLY public.import_jobs ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sheet_product_links ADD CONSTRAINT sheet_product_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sheet_product_links ADD CONSTRAINT sheet_product_links_uniq
    UNIQUE (tenant_id, spreadsheet_id, product_id);

ALTER TABLE ONLY public.owners        ADD CONSTRAINT owners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.owners        ADD CONSTRAINT owners_email_key UNIQUE (email);
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_owner_tenant_key UNIQUE (owner_id, tenant_id);

ALTER TABLE ONLY public.tenant_bank_accounts ADD CONSTRAINT tenant_bank_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_domain_key UNIQUE (domain);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_status_check
    CHECK (status IN ('pending','verifying','dns-verified','cert-pending','verified','failed','expired'));
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_owner_id_key UNIQUE (owner_id);
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_status_check
    CHECK (status IN ('draft','submitted'));
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_tenant_id_key UNIQUE (tenant_id);
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_status_check
    CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_business_type_check
    CHECK (business_type IN ('proprietor','partnership','pvt_ltd','llp','other'));
ALTER TABLE ONLY public.tenant_social_accounts ADD CONSTRAINT tenant_social_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_social_accounts ADD CONSTRAINT tenant_social_accounts_tenant_provider_key UNIQUE (tenant_id, provider);
ALTER TABLE ONLY public.tenant_social_accounts ADD CONSTRAINT tenant_social_accounts_provider_check
    CHECK (provider IN ('facebook','instagram','gbp','youtube','pinterest','linkedin','x'));
ALTER TABLE ONLY public.tenant_social_accounts ADD CONSTRAINT tenant_social_accounts_status_check
    CHECK (status IN ('connected','pending','expired','revoked'));
ALTER TABLE ONLY public.scheduled_social_posts ADD CONSTRAINT scheduled_social_posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.scheduled_social_posts ADD CONSTRAINT scheduled_social_posts_platform_check
    CHECK (platform IN ('fb','ig','ig_reel','gbp','youtube','pinterest','linkedin','x'));
ALTER TABLE ONLY public.scheduled_social_posts ADD CONSTRAINT scheduled_social_posts_status_check
    CHECK (status IN ('draft','pending','publishing','posted','failed','cancelled'));
ALTER TABLE ONLY public.scheduled_social_posts ADD CONSTRAINT scheduled_social_posts_approval_check
    CHECK (approval_status IN ('none','pending','approved','rejected'));
ALTER TABLE ONLY public.social_post_insights ADD CONSTRAINT social_post_insights_pkey PRIMARY KEY (post_id);
ALTER TABLE ONLY public.social_inbox ADD CONSTRAINT social_inbox_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.social_templates ADD CONSTRAINT social_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.social_autopost_rules ADD CONSTRAINT social_autopost_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.social_autopost_rules ADD CONSTRAINT social_autopost_rules_trigger_check
    CHECK (trigger IN ('new_product','back_in_stock','price_drop'));
ALTER TABLE ONLY public.social_autopost_seen ADD CONSTRAINT social_autopost_seen_pkey PRIMARY KEY (tenant_id, product_id);
ALTER TABLE ONLY public.tenant_integration_credentials ADD CONSTRAINT tenant_integration_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_integration_credentials ADD CONSTRAINT tenant_integration_credentials_tenant_provider_key UNIQUE (tenant_id, provider);
ALTER TABLE ONLY public.tenant_integration_credentials ADD CONSTRAINT tenant_integration_credentials_status_check
    CHECK (status IN ('connected','error','revoked'));
ALTER TABLE ONLY public.platform_infra ADD CONSTRAINT platform_infra_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.tenant_ca ADD CONSTRAINT tenant_ca_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY public.tenant_admin_certs ADD CONSTRAINT tenant_admin_certs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_admin_certs ADD CONSTRAINT tenant_admin_certs_serial_key UNIQUE (serial);
ALTER TABLE ONLY public.provisioning_step_events
    ADD CONSTRAINT provisioning_step_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_certs ADD CONSTRAINT portal_certs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_certs ADD CONSTRAINT portal_certs_serial_key UNIQUE (serial);
ALTER TABLE ONLY public.portal_certs ADD CONSTRAINT portal_certs_download_token_key UNIQUE (download_token);

ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_status_check CHECK (status IN ('active','revoked'));
ALTER TABLE ONLY public.api_key_usage_daily ADD CONSTRAINT api_key_usage_daily_pkey PRIMARY KEY (api_key_id, day);
ALTER TABLE ONLY public.ai_price_list ADD CONSTRAINT ai_price_list_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ai_price_list ADD CONSTRAINT ai_price_list_key UNIQUE (capability, provider, model, unit_type);
ALTER TABLE ONLY public.ai_price_list ADD CONSTRAINT ai_price_list_capability_check
    CHECK (capability IN ('text','embed','vision','image','video'));
ALTER TABLE ONLY public.ai_price_list ADD CONSTRAINT ai_price_list_unit_type_check
    CHECK (unit_type IN ('token_1k_in','token_1k_out','image','video_second','call'));
ALTER TABLE ONLY public.platform_provider_settings ADD CONSTRAINT platform_provider_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_provider_settings ADD CONSTRAINT platform_provider_settings_key_check
    CHECK (key IN ('sms_provider','whatsapp_provider','ai_text_providers','ai_image_providers','ai_video_providers','ai_image_default_quality'));
ALTER TABLE ONLY public.ai_provider_identities ADD CONSTRAINT ai_provider_identities_pkey PRIMARY KEY (tenant_id, provider);
ALTER TABLE ONLY public.ai_provider_identities ADD CONSTRAINT ai_provider_identities_provider_check
    CHECK (provider IN ('anthropic'));
ALTER TABLE ONLY public.tenants ADD CONSTRAINT tenants_upi_mode_check
    CHECK (upi_mode IN ('auto','off'));
ALTER TABLE ONLY public.linked_account_settlements ADD CONSTRAINT linked_account_settlements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.razorpay_downtimes ADD CONSTRAINT razorpay_downtimes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.compute_prices ADD CONSTRAINT compute_prices_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.compute_prices ADD CONSTRAINT compute_prices_kind_check
    CHECK (kind IN ('ec2','rds','rds_storage','ebs'));
ALTER TABLE ONLY public.tenant_compute ADD CONSTRAINT tenant_compute_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY public.tenant_compute ADD CONSTRAINT tenant_compute_status_check
    CHECK (status IN ('pending','applying','applied','failed','paused','scheduled'));
ALTER TABLE ONLY public.tenant_compute ADD CONSTRAINT tenant_compute_apply_mode_check
    CHECK (apply_mode IN ('window','now'));

-- 'scheduled': the owner picked a smaller spec that becomes active at the next subscription cycle.
ALTER TABLE public.tenant_compute DROP CONSTRAINT IF EXISTS tenant_compute_status_check;
ALTER TABLE public.tenant_compute ADD CONSTRAINT tenant_compute_status_check
    CHECK (status IN ('pending','applying','applied','failed','paused','scheduled'));
ALTER TABLE ONLY public.tenant_compute_periods ADD CONSTRAINT tenant_compute_periods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plans ADD CONSTRAINT plans_min_placement_check CHECK (min_placement IN ('pool','dedicated'));
ALTER TABLE ONLY public.shared_db_hosts ADD CONSTRAINT shared_db_hosts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shared_db_hosts ADD CONSTRAINT shared_db_hosts_status_check
    CHECK (status IN ('creating','available','retired'));
ALTER TABLE ONLY public.admin_api_tokens ADD CONSTRAINT admin_api_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admin_api_tokens ADD CONSTRAINT admin_api_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.admin_api_tokens ADD CONSTRAINT admin_api_tokens_kind_check
    CHECK (kind IN ('cli','service_account','extension'));
ALTER TABLE ONLY public.admin_api_tokens ADD CONSTRAINT admin_api_tokens_status_check
    CHECK (status IN ('pending','denied','active','revoked'));
ALTER TABLE ONLY public.admin_api_tokens ADD CONSTRAINT admin_api_tokens_holder_check
    CHECK (status IN ('pending','denied') OR (kind = 'service_account' AND service_account_id IS NOT NULL) OR (kind <> 'service_account' AND admin_id IS NOT NULL));
ALTER TABLE ONLY public.platform_setup_progress ADD CONSTRAINT platform_setup_progress_pkey PRIMARY KEY (item_id);
ALTER TABLE ONLY public.platform_setup_progress ADD CONSTRAINT platform_setup_progress_state_check
    CHECK (state IN ('applied','approved','skipped'));
ALTER TABLE ONLY public.tenants ADD CONSTRAINT tenants_messaging_addon_check
    CHECK (messaging_addon IN ('none','sms','whatsapp','both'));
ALTER TABLE ONLY public.tenants ADD CONSTRAINT tenants_requested_addons_check
    CHECK (requested_addons <@ ARRAY['messaging','ad_free']::text[]);
ALTER TABLE ONLY public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_tenant_channel_key UNIQUE (tenant_id, channel);
ALTER TABLE ONLY public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_channel_check
    CHECK (channel IN ('sms','whatsapp'));
ALTER TABLE ONLY public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_provider_check
    CHECK (provider IN ('twilio','aws'));
ALTER TABLE ONLY public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_status_check
    CHECK (status IN ('active','disabled'));
ALTER TABLE ONLY public.tenant_archives ADD CONSTRAINT tenant_archives_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_archives ADD CONSTRAINT tenant_archives_status_check
    CHECK (status IN ('available','restored','expired'));
ALTER TABLE ONLY public.tenant_domain_orders ADD CONSTRAINT tenant_domain_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_domain_orders ADD CONSTRAINT tenant_domain_orders_status_check
    CHECK (status IN ('requested','registering','configuring','active','failed','cancelled','expired'));
ALTER TABLE ONLY public.tenant_domain_orders ADD CONSTRAINT tenant_domain_orders_source_check
    CHECK (source IN ('dashboard','onboarding'));
ALTER TABLE ONLY public.tenant_domain_renewals ADD CONSTRAINT tenant_domain_renewals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_domain_renewals ADD CONSTRAINT tenant_domain_renewals_order_term_key UNIQUE (order_id, term_expires_at);
ALTER TABLE ONLY public.tenant_domain_renewals ADD CONSTRAINT tenant_domain_renewals_status_check
    CHECK (status IN ('due','renewing','done','lapsed','off'));
