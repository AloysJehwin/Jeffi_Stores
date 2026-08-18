-- Jeffi Stores SaaS control-plane schema
-- Separate database (jeffi_control_plane) — the source of truth for tenants,
-- plans, feature entitlements, and per-tenant infrastructure pointers.
-- NOT the per-tenant business data (that lives in each tenant's own RDS).
--
-- Apply (LOCAL ONLY): psql postgresql://<user>@localhost:5432/jeffi_control_plane -f database/control-plane/schema.sql
-- No cross-DB FK to the app schema (tenant_id on auth_sessions is validated in the app layer).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--
-- plans: the 4 SaaS tiers. Feature entitlements are in plan_features.
--
CREATE TABLE IF NOT EXISTS public.plans (
    id             uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug           character varying(40) NOT NULL,          -- 'basic' | 'growth' | 'pro' | 'enterprise'
    name           character varying(80) NOT NULL,
    tier           integer NOT NULL,                        -- 1..4, ordering
    monthly_price_inr  numeric(12,2) NOT NULL DEFAULT 0,
    max_custom_domains integer       NOT NULL DEFAULT 0,  -- 0=none, 1=Pro, 3=Enterprise
    is_active          boolean       NOT NULL DEFAULT true,
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

--
-- plan_features: which admin scope keys each plan enables. One row per (plan, scope_key).
-- Storefront features are NOT gated (every plan gets the full storefront); only
-- admin-panel scope keys (from src/lib/scopes.ts) are entitled here.
--
CREATE TABLE IF NOT EXISTS public.plan_features (
    id          uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    plan_id     uuid NOT NULL,
    scope_key   character varying(64) NOT NULL,             -- matches ADMIN_SCOPES key, e.g. 'quotations:read'
    created_at  timestamp with time zone NOT NULL DEFAULT now()
);

--
-- tenants: one row per customer store. slug drives {slug}.jeffistores.in.
--
CREATE TABLE IF NOT EXISTS public.tenants (
    id             uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug           character varying(63) NOT NULL,          -- subdomain label; reserved words blocked in app
    custom_domain  character varying(255),                  -- optional BYO domain (priced add-on)
    display_name   character varying(200) NOT NULL,
    plan_id        uuid,
    status                   character varying(20) NOT NULL DEFAULT 'provisioning', -- provisioning|active|suspended|terminated
    razorpay_subscription_id character varying(64),         -- Razorpay sub_xxxx; set after checkout redirect
    razorpay_checkout_url    text,                           -- Razorpay hosted checkout short_url; shown to owner post-approval
    razorpay_linked_account_id character varying(64),        -- Razorpay Route acc_xxxx; created on KYC approval for POBO transfers
    subscription_status      character varying(20) NOT NULL DEFAULT 'created', -- created|authenticated|active|halted|cancelled|completed|expired
    billing_interval         character varying(8)  NOT NULL DEFAULT 'monthly', -- monthly|yearly
    -- Generated email addresses — derived from slug, no per-tenant SES identity needed
    noreply_email  character varying(120) GENERATED ALWAYS AS ('noreply-' || slug || '@jeffistores.in') STORED,
    campaign_email character varying(120) GENERATED ALWAYS AS ('campaigns-' || slug || '@jeffistores.in') STORED,
    daily_payout             boolean NOT NULL DEFAULT false, -- +5% upgrade flag
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

--
-- tenant_infra: per-tenant infrastructure pointers used by the request-time
-- host->tenant resolver + tenant-aware pool/S3 selection.
--
CREATE TABLE IF NOT EXISTS public.tenant_infra (
    id             uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id      uuid NOT NULL,
    rds_endpoint   character varying(255),                  -- tenant's dedicated RDS host
    rds_db         character varying(64) NOT NULL DEFAULT 'jeffi_stores',
    rds_port       integer NOT NULL DEFAULT 5432,
    db_secret_ref  character varying(255),                  -- Secrets Manager id for tenant DB creds (if not IAM)
    iam_auth       boolean NOT NULL DEFAULT true,
    s3_bucket      character varying(255),                  -- bucket-per-tenant
    ec2_target     character varying(255),                  -- 'pool' or a dedicated instance/ASG id
    region         character varying(32) NOT NULL DEFAULT 'us-east-1',
    cloudfront_id  character varying(64),
    cert_arn       character varying(512),
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

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
    CHECK (status IN ('provisioning','active','suspended','terminated','pending_approval','rejected'));
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_subscription_status_check
    CHECK (subscription_status IN ('created','authenticated','active','halted','cancelled','completed','expired'));
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_billing_interval_check
    CHECK (billing_interval IN ('monthly','yearly'));
ALTER TABLE ONLY public.plans          ADD CONSTRAINT plans_tier_check CHECK (tier BETWEEN 1 AND 4);

-- FKs are safe here: all four tables live in the SAME control-plane DB.
ALTER TABLE ONLY public.plan_features  ADD CONSTRAINT plan_features_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenants        ADD CONSTRAINT tenants_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tenant_infra   ADD CONSTRAINT tenant_infra_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ── Indexes (beyond PK/UNIQUE-backed) ──
CREATE INDEX IF NOT EXISTS idx_tenants_plan_id ON public.tenants USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tenants_rzp_sub ON public.tenants USING btree (razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id ON public.plan_features USING btree (plan_id);
-- host->tenant resolver looks up by slug (UNIQUE already indexes it) and custom_domain (UNIQUE too).

--
-- tenant_transactions: one row per payment on a tenant's store (POBO split).
-- gross = what the buyer paid; tenant_share = seller's cut; platform_commission =
-- our cut; gateway_fee = Razorpay/Route fee. is_cod flags cash-on-delivery (settled
-- separately via COD remittance, not the online gateway).
--
CREATE TABLE IF NOT EXISTS public.tenant_transactions (
    id                  uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id           uuid NOT NULL,
    order_ref           character varying(64),               -- the tenant order id/number
    gross_amount        numeric(12,2) NOT NULL,
    tenant_share        numeric(12,2) NOT NULL,
    platform_commission numeric(12,2) NOT NULL DEFAULT 0,
    gateway_fee         numeric(12,2) NOT NULL DEFAULT 0,
    is_cod              boolean NOT NULL DEFAULT false,
    gateway             character varying(32) NOT NULL DEFAULT 'razorpay_route',
    gateway_txn_id      character varying(128),
    status              character varying(24) NOT NULL DEFAULT 'captured', -- captured|split|settled|refunded|failed
    occurred_at         timestamp with time zone NOT NULL DEFAULT now(),
    created_at          timestamp with time zone NOT NULL DEFAULT now()
);

--
-- settlement_ledger: per-tenant running money movements. The single reconciliation
-- surface: +order_capture / -commission / -gateway_fee / -subscription_charge /
-- +cod_remittance / -delhivery_correction / -refund / -payout. Signed amount.
--
CREATE TABLE IF NOT EXISTS public.settlement_ledger (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id     uuid NOT NULL,
    entry_type    character varying(32) NOT NULL,  -- order_capture|commission|gateway_fee|subscription_charge|cod_remittance|delhivery_correction|refund|payout|adjustment
    amount        numeric(12,2) NOT NULL,          -- signed: credits +, debits -
    txn_id        uuid,                            -- optional link to tenant_transactions
    note          character varying(255),
    occurred_at   timestamp with time zone NOT NULL DEFAULT now(),
    created_at    timestamp with time zone NOT NULL DEFAULT now()
);

--
-- tenant_metrics_daily: rollup for charts (tenant count, MRR, txn volume by day).
--
CREATE TABLE IF NOT EXISTS public.tenant_metrics_daily (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    metric_date   date NOT NULL,
    active_tenants integer NOT NULL DEFAULT 0,
    mrr_inr       numeric(14,2) NOT NULL DEFAULT 0,
    gmv_inr       numeric(14,2) NOT NULL DEFAULT 0,     -- gross merchandise value across tenants that day
    created_at    timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.tenant_transactions  ADD CONSTRAINT tenant_transactions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.settlement_ledger    ADD CONSTRAINT settlement_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_metrics_daily ADD CONSTRAINT tenant_metrics_daily_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_metrics_daily ADD CONSTRAINT tenant_metrics_daily_date_key UNIQUE (metric_date);

ALTER TABLE ONLY public.tenant_transactions ADD CONSTRAINT tenant_transactions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.settlement_ledger ADD CONSTRAINT settlement_ledger_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tenant_transactions_tenant ON public.tenant_transactions USING btree (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_ledger_tenant ON public.settlement_ledger USING btree (tenant_id, occurred_at DESC);

--
-- instance_state on tenants: tracks RDS running state for the disable toggle.
-- 'running' (normal) | 'stopped' (RDS stopped to save cost — test tenant only).
-- Separate from status (active/suspended/…) so a stopped test instance is still
-- an 'active' tenant, just with its DB powered down.
--
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS instance_state character varying(16) NOT NULL DEFAULT 'running';

--
-- provisioning_jobs: async state machine that turns a 'provisioning' tenant into
-- a real, 'active' one. One row per tenant provision attempt; the worker advances
-- one step per tick. created_resources tracks what's been made for rollback.
--
CREATE TABLE IF NOT EXISTS public.provisioning_jobs (
    id                 uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id          uuid NOT NULL,
    step               character varying(32) NOT NULL DEFAULT 'preflight',
    status             character varying(16) NOT NULL DEFAULT 'pending', -- pending|running|done|failed
    attempts           integer NOT NULL DEFAULT 0,
    next_attempt_at    timestamp with time zone,             -- set on retryable failure (exp backoff); worker skips until due
    last_error         text,
    created_resources  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {secretArn, paramGroup, dbInstanceId, bucket}
    created_at         timestamp with time zone NOT NULL DEFAULT now(),
    updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

--
-- tenant_migration_runs: per-tenant record of a schema/migration fan-out (Part B).
-- One row per (tenant, deploy) so a failure on one tenant is visible, not hidden.
--
CREATE TABLE IF NOT EXISTS public.tenant_migration_runs (
    id          uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id   uuid NOT NULL,
    git_sha     character varying(64),
    status      character varying(16) NOT NULL DEFAULT 'pending', -- pending|success|failed
    applied_sql text,
    error       text,
    ran_at      timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.provisioning_jobs     ADD CONSTRAINT provisioning_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_migration_runs ADD CONSTRAINT tenant_migration_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.provisioning_jobs     ADD CONSTRAINT provisioning_jobs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_migration_runs ADD CONSTRAINT tenant_migration_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_tenant ON public.provisioning_jobs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_active ON public.provisioning_jobs USING btree (status) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS idx_tenant_migration_runs_tenant ON public.tenant_migration_runs USING btree (tenant_id, ran_at DESC);

--
-- owners: ecom store OWNERS — the people who sign up at ecom.jeffistores.in to
-- create/run a store. A NEW principal, distinct from admins (platform staff) and
-- customers/business (shoppers within a tenant). Passwordless auth (OTP + Google)
-- reusing the storefront verification services — no password stored here.
--
CREATE TABLE IF NOT EXISTS public.owners (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email         character varying(255) NOT NULL,
    name          character varying(200),
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

--
-- owner_tenants: which tenant(s) an owner owns (M:N to allow multi-store owners).
--
CREATE TABLE IF NOT EXISTS public.owner_tenants (
    id         uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id   uuid NOT NULL,
    tenant_id  uuid NOT NULL,
    role       character varying(20) NOT NULL DEFAULT 'owner',  -- owner | member (future)
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.owners        ADD CONSTRAINT owners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.owners        ADD CONSTRAINT owners_email_key UNIQUE (email);
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_owner_tenant_key UNIQUE (owner_id, tenant_id);
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.owner_tenants ADD CONSTRAINT owner_tenants_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_owner_tenants_owner ON public.owner_tenants USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_tenants_tenant ON public.owner_tenants USING btree (tenant_id);

--
-- tenant_bank_accounts: the payout account for an owner's store, verified via
-- penny-drop (Razorpay Fund Account Validation) before go-live. verification_status
-- gates tenant creation (mandatory-before-go-live). linked_account_id = the Route
-- linked-account id once created.
--
CREATE TABLE IF NOT EXISTS public.tenant_bank_accounts (
    id                  uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id            uuid NOT NULL,
    tenant_id           uuid,                                -- set once the tenant is created
    account_number      character varying(34),
    ifsc                character varying(16),
    holder_name         character varying(200),
    upi_id              character varying(120),
    verification_status character varying(16) NOT NULL DEFAULT 'pending', -- pending|initiated|verified|failed
    verification_ref    character varying(128),              -- Razorpay validation id
    verified_name       character varying(200),              -- name returned by the bank (penny-drop)
    linked_account_id   character varying(64),               -- Razorpay Route linked account
    -- Dual penny-drop UTR verification fields
    penny_fund_account_id  character varying(64),            -- Razorpay fund_account id
    penny_payout_id_1      character varying(64),            -- payout id for first ₹1 transfer
    penny_payout_id_2      character varying(64),            -- payout id for second ₹1 transfer
    penny_expected_utr_1   character varying(64),            -- UTR we sent (from Razorpay response)
    penny_expected_utr_2   character varying(64),            -- UTR we sent (from Razorpay response)
    penny_utr_1            character varying(64),            -- UTR entered by owner
    penny_utr_2            character varying(64),            -- UTR entered by owner
    created_at          timestamp with time zone NOT NULL DEFAULT now(),
    updated_at          timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.tenant_bank_accounts ADD CONSTRAINT tenant_bank_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_bank_accounts ADD CONSTRAINT tenant_bank_accounts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tenant_bank_owner ON public.tenant_bank_accounts USING btree (owner_id);

-- ── Custom domains (BYO CNAME): Pro=1, Enterprise=3 per plan.max_custom_domains ──
-- Multi-domain per tenant (supersedes the single tenants.custom_domain column).
CREATE TABLE IF NOT EXISTS public.tenant_custom_domains (
    id                 uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id          uuid NOT NULL,
    domain             character varying(255) NOT NULL,
    status             character varying(16) NOT NULL DEFAULT 'pending', -- pending|verifying|verified|failed
    verification_token character varying(64),   -- CNAME/TXT token owner must publish
    cert_arn           character varying(512),   -- ACM cert once issued
    cloudfront_id      character varying(64),
    verified_at        timestamp with time zone,
    created_at         timestamp with time zone NOT NULL DEFAULT now(),
    updated_at         timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_domain_key UNIQUE (domain);
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_tenant_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_custom_domains ADD CONSTRAINT tenant_custom_domains_status_check
    CHECK (status IN ('pending','verifying','verified','failed'));
CREATE INDEX IF NOT EXISTS idx_tcd_tenant ON public.tenant_custom_domains USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tcd_domain ON public.tenant_custom_domains USING btree (domain) WHERE status='verified';

-- ── Onboarding drafts: persists wizard progress so owners can resume ──────────
CREATE TABLE IF NOT EXISTS public.onboarding_drafts (
    id          uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id    uuid NOT NULL,
    current_step integer NOT NULL DEFAULT 0,
    data        jsonb NOT NULL DEFAULT '{}',
    status      character varying(16) NOT NULL DEFAULT 'draft', -- draft|submitted
    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    updated_at  timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_owner_id_key UNIQUE (owner_id);
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.onboarding_drafts ADD CONSTRAINT onboarding_drafts_status_check
    CHECK (status IN ('draft','submitted'));

-- ── Tenant KYC: GST cert + business details, reviewed by platform admin ───────
CREATE TABLE IF NOT EXISTS public.tenant_kyc (
    id              uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id       uuid NOT NULL,
    owner_id        uuid NOT NULL,
    gst_number      character varying(20),
    gst_cert_s3_key character varying(512),   -- S3 key: kyc/{owner_id}/{uuid}-{filename}
    pan             character varying(16),
    business_name   character varying(200),
    business_type   character varying(32),    -- proprietor|partnership|pvt_ltd|llp|other
    business_address text,
    product_categories text,                  -- comma-separated or free text
    status          character varying(16) NOT NULL DEFAULT 'pending', -- pending|approved|rejected
    reviewer_note   text,
    reviewed_by     character varying(200),   -- admin email
    reviewed_at     timestamp with time zone,
    created_at      timestamp with time zone NOT NULL DEFAULT now(),
    updated_at      timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_tenant_id_key UNIQUE (tenant_id);
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_status_check
    CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE ONLY public.tenant_kyc ADD CONSTRAINT tenant_kyc_business_type_check
    CHECK (business_type IN ('proprietor','partnership','pvt_ltd','llp','other'));
CREATE INDEX IF NOT EXISTS idx_tenant_kyc_status ON public.tenant_kyc USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tenant_kyc_owner ON public.tenant_kyc USING btree (owner_id);
