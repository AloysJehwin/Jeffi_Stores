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
    monthly_price_inr numeric(12,2) NOT NULL DEFAULT 0,
    is_active      boolean NOT NULL DEFAULT true,
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
    status         character varying(20) NOT NULL DEFAULT 'provisioning', -- provisioning|active|suspended|terminated
    daily_payout   boolean NOT NULL DEFAULT false,          -- +5% upgrade flag
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
    CHECK (status IN ('provisioning','active','suspended','terminated'));
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
CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id ON public.plan_features USING btree (plan_id);
-- host->tenant resolver looks up by slug (UNIQUE already indexes it) and custom_domain (UNIQUE too).
