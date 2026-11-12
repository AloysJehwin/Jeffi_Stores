-- controller-service: foreign-keys (control-plane set). Load order comes from scripts/db-files.mjs.

-- FKs are safe here: all four tables live in the SAME control-plane DB.
ALTER TABLE ONLY public.plan_features  ADD CONSTRAINT plan_features_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tenant_infra   ADD CONSTRAINT tenant_infra_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_transactions ADD CONSTRAINT tenant_transactions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.settlement_ledger ADD CONSTRAINT settlement_ledger_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_wallets ADD CONSTRAINT tenant_wallets_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.wallet_ledger  ADD CONSTRAINT wallet_ledger_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provisioning_jobs     ADD CONSTRAINT provisioning_jobs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_migration_runs ADD CONSTRAINT tenant_migration_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_bank_accounts ADD CONSTRAINT tenant_bank_accounts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_tenant_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.scheduled_social_posts ADD CONSTRAINT scheduled_social_posts_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.social_post_insights ADD CONSTRAINT social_post_insights_post_fkey
    FOREIGN KEY (post_id) REFERENCES public.scheduled_social_posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_ca ADD CONSTRAINT tenant_ca_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_admin_certs ADD CONSTRAINT tenant_admin_certs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provisioning_step_events
    ADD CONSTRAINT provisioning_step_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.portal_certs ADD CONSTRAINT portal_certs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.admin_mobiles ADD CONSTRAINT admin_mobiles_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_owner_id_fkey  FOREIGN KEY (owner_id)  REFERENCES public.owners(id)  ON DELETE CASCADE;
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.api_key_usage_daily ADD CONSTRAINT api_key_usage_daily_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.platform_provider_settings ADD CONSTRAINT platform_provider_settings_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.linked_account_settlements ADD CONSTRAINT linked_account_settlements_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_compute ADD CONSTRAINT tenant_compute_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_compute_periods ADD CONSTRAINT tenant_compute_periods_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_archives ADD CONSTRAINT tenant_archives_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_archives ADD CONSTRAINT tenant_archives_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
