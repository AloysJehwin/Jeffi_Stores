-- controller-service: indexes (control-plane set). Load order comes from scripts/db-files.mjs.

-- ── Indexes (beyond PK/UNIQUE-backed) ──
CREATE INDEX IF NOT EXISTS idx_tenants_plan_id ON public.tenants USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tenants_rzp_sub ON public.tenants USING btree (razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id ON public.plan_features USING btree (plan_id);

CREATE INDEX IF NOT EXISTS idx_tenant_transactions_tenant ON public.tenant_transactions USING btree (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_ledger_tenant ON public.settlement_ledger USING btree (tenant_id, occurred_at DESC);

-- One row per payment: verify + webhook + reconcile racing can never record (or transfer) twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_transactions_tenant_payment
    ON public.tenant_transactions USING btree (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_transactions_payment ON public.tenant_transactions USING btree (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_transactions_transfer ON public.tenant_transactions USING btree (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_transactions_open
    ON public.tenant_transactions USING btree (occurred_at) WHERE status IN ('captured', 'split');
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_ledger_external_ref
    ON public.settlement_ledger USING btree (tenant_id, entry_type, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant_time ON public.wallet_ledger USING btree (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant ON public.wallet_ledger USING btree (tenant_id, occurred_at DESC);
-- one debit per (tenant, awb): the DB-level idempotency guard for the debit-on-AWB hook.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_tenant_awb_debit
    ON public.wallet_ledger USING btree (tenant_id, awb)
    WHERE awb IS NOT NULL AND entry_type = 'debit';

-- one credit per (tenant, external_ref): the DB-level guard that makes a wallet top-up
-- idempotent across concurrent verifies and webhook retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_tenant_external_ref
    ON public.wallet_ledger USING btree (tenant_id, external_ref)
    WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_tenant ON public.provisioning_jobs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_active ON public.provisioning_jobs USING btree (status) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS idx_tenant_migration_runs_tenant ON public.tenant_migration_runs USING btree (tenant_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_active ON public.import_jobs USING btree (status) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON public.import_jobs USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_product_links_sheet ON public.sheet_product_links USING btree (tenant_id, spreadsheet_id);

CREATE INDEX IF NOT EXISTS idx_owner_tenants_owner ON public.owner_tenants USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_tenants_tenant ON public.owner_tenants USING btree (tenant_id);
-- One bank record per owner: saveBankVerification upserts ON CONFLICT (owner_id).
CREATE UNIQUE INDEX IF NOT EXISTS tenant_bank_accounts_owner_id_key ON public.tenant_bank_accounts USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_tcd_tenant ON public.tenant_custom_domains USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tcd_domain ON public.tenant_custom_domains USING btree (domain) WHERE status='verified';
CREATE INDEX IF NOT EXISTS idx_tenant_kyc_status ON public.tenant_kyc USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tenant_kyc_owner ON public.tenant_kyc USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_tenant_social_tenant ON public.tenant_social_accounts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_social_fb_user ON public.tenant_social_accounts USING btree (fb_user_id) WHERE fb_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_social_due ON public.scheduled_social_posts USING btree (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_social_tenant ON public.scheduled_social_posts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_social_group ON public.scheduled_social_posts USING btree (group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_inbox_external ON public.social_inbox USING btree (network, external_id);
CREATE INDEX IF NOT EXISTS idx_social_inbox_tenant ON public.social_inbox USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_templates_tenant ON public.social_templates USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_integration_tenant ON public.tenant_integration_credentials USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_admin_certs_tenant ON public.tenant_admin_certs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_admin_certs_active ON public.tenant_admin_certs USING btree (serial) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_provisioning_step_events_job
    ON public.provisioning_step_events USING btree (job_id, created_at);
-- Portal lists a signed-in admin's certs by their verified email; lower() for case-insensitive match.
CREATE INDEX IF NOT EXISTS idx_portal_certs_issued_to ON public.portal_certs USING btree (lower(issued_to));
CREATE INDEX IF NOT EXISTS idx_portal_certs_downloadable
    ON public.portal_certs USING btree (download_token) WHERE revoked_at IS NULL AND downloaded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_mobiles_admin_key
    ON public.admin_mobiles USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), admin_id);
CREATE UNIQUE INDEX IF NOT EXISTS admin_mobiles_phone_store_key
    ON public.admin_mobiles USING btree (phone, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_admin_mobiles_phone ON public.admin_mobiles USING btree (phone);

CREATE INDEX IF NOT EXISTS idx_rzp_sub_index_tenant ON public.razorpay_subscription_index USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_price_list_lookup ON public.ai_price_list USING btree (capability, unit_type, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_provider_settings_scope_key ON public.platform_provider_settings
    USING btree ((COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), key);
CREATE INDEX IF NOT EXISTS idx_linked_account_settlements_tenant ON public.linked_account_settlements USING btree (tenant_id, settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_razorpay_downtimes_open ON public.razorpay_downtimes USING btree (updated_at DESC) WHERE (status <> 'resolved'::text);
CREATE INDEX IF NOT EXISTS idx_tenant_compute_pending ON public.tenant_compute USING btree (next_at) WHERE (status IN ('pending','applying'));
CREATE INDEX IF NOT EXISTS idx_tenant_compute_periods_tenant ON public.tenant_compute_periods USING btree (tenant_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_compute_periods_open ON public.tenant_compute_periods USING btree (tenant_id) WHERE (ended_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_api_tokens_device_code ON public.admin_api_tokens USING btree (device_code_hash) WHERE (device_code_hash IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_api_tokens_user_code ON public.admin_api_tokens USING btree (user_code) WHERE (status = 'pending');
CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_admin ON public.admin_api_tokens USING btree (tenant_id, admin_id) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_service_account ON public.admin_api_tokens USING btree (tenant_id, service_account_id) WHERE (service_account_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_platform_setup_progress_state ON public.platform_setup_progress USING btree (state);
CREATE INDEX IF NOT EXISTS idx_tenant_messaging_senders_tenant ON public.tenant_messaging_senders USING btree (tenant_id);
