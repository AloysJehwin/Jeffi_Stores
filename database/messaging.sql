-- Messaging templates library (per-tenant).
-- Three-level identity: template_family (logical) → template (per channel) → template_variant (per locale) → template_version (snapshot history).
-- Plus: template_asset, template_variable, brand_theme (branding merged at render), sms_dlt / sms_dlt_template (India DLT), short_link (first-party SMS shortener), waba_capacity, wa_pricing (effective-dated).
-- Applied to the tenant DB by the schema pipeline. LOCAL ONLY (never RDS).

CREATE TABLE IF NOT EXISTS public.template_family (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    space character varying(16) DEFAULT 'store'::character varying NOT NULL,
    slug character varying(80) NOT NULL,
    name character varying(120) NOT NULL,
    category character varying(32),
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    family_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    channel character varying(16) NOT NULL,
    current_variant_id uuid,
    status character varying(16) NOT NULL DEFAULT 'draft',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale character varying(10) NOT NULL DEFAULT 'en',
    current_version_id uuid,
    provider_ref character varying(80),
    meta_category character varying(16),
    media_type character varying(16),
    approval_status character varying(20) NOT NULL DEFAULT 'unsubmitted',
    approval_raw_status character varying(40),
    approval_reason text,
    approval_submitted_at timestamp with time zone,
    approval_approved_at timestamp with time zone,
    approval_checked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_version (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    version integer NOT NULL,
    subject character varying(200),
    body text NOT NULL,
    blocks jsonb,
    blocks_format character varying(16),
    variables text[] NOT NULL DEFAULT '{}',
    provider_ref character varying(80),
    layout character varying(16) DEFAULT 'store'::character varying NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_asset (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid,
    kind character varying(16) NOT NULL,
    s3_key text NOT NULL,
    cdn_url text NOT NULL,
    mime character varying(80) NOT NULL,
    bytes bigint NOT NULL,
    width integer,
    height integer,
    checksum character varying(80),
    is_approval_sample boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_variable (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    key character varying(64) NOT NULL,
    label character varying(120) NOT NULL,
    description text,
    sample_value text,
    source character varying(16) NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS public.brand_theme (
    tenant_id uuid NOT NULL,
    logo_url text,
    primary_color character varying(16),
    accent_color character varying(16),
    font_stack text,
    footer_html text,
    address_html text,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_dlt (
    tenant_id uuid NOT NULL,
    entity_id character varying(40),
    default_header character varying(16),
    provider character varying(16) NOT NULL,
    verified boolean NOT NULL DEFAULT false,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_dlt_template (
    variant_id uuid NOT NULL,
    dlt_template_id character varying(40) NOT NULL,
    dlt_header character varying(16) NOT NULL,
    dlt_route character varying(16) NOT NULL,
    dlt_approval_status character varying(16) NOT NULL DEFAULT 'pending',
    dlt_notes text
);

CREATE TABLE IF NOT EXISTS public.short_link (
    code character varying(16) NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid,
    campaign_id uuid,
    destination_url text NOT NULL,
    kind character varying(16) NOT NULL,
    expires_at timestamp with time zone,
    click_count bigint NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.waba_capacity (
    waba_id character varying(40) NOT NULL,
    account_sid character varying(40),
    approved_count integer NOT NULL DEFAULT 0,
    pending_count integer NOT NULL DEFAULT 0,
    last_synced_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.wa_pricing (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    country character varying(2) NOT NULL,
    category character varying(20) NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    inr_per_message numeric(10,4) NOT NULL,
    source character varying(20) NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Platform messaging-templates catalog (singleton, admin-owned) — RESERVED, currently unused.
-- Tenant-facing defaults are NOT copied on provision: they live in template_* under the platform
-- tenant (tenant_id = 00000000-…) in the flagship DB and are merged at read time by
-- messaging-service (templates-v2 *WithDefaults) with the tenant's own template_* rows.
-- These tables remain for the public-API customer copy (pub_template_*) story below.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_template_family (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug character varying(80) NOT NULL,
    name character varying(120) NOT NULL,
    category character varying(32),
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_template (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    family_id uuid NOT NULL,
    channel character varying(16) NOT NULL,
    current_variant_id uuid,
    status character varying(16) NOT NULL DEFAULT 'active',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_template_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id uuid NOT NULL,
    locale character varying(10) NOT NULL DEFAULT 'en',
    current_version_id uuid,
    provider_ref character varying(80),
    meta_category character varying(16),
    media_type character varying(16),
    approval_status character varying(20) NOT NULL DEFAULT 'approved',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_template_version (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    version integer NOT NULL,
    subject character varying(200),
    body text NOT NULL,
    blocks jsonb,
    blocks_format character varying(16),
    variables text[] NOT NULL DEFAULT '{}',
    provider_ref character varying(80),
    note text,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Public-API customer template copies (scoped by public_user_id).
-- Public-API customers do NOT get a dedicated DB (store tenants do); their
-- template copies live here in the same DB alongside the per-tenant and platform shapes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pub_template_family (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    public_user_id uuid NOT NULL,
    slug character varying(80) NOT NULL,
    name character varying(120) NOT NULL,
    category character varying(32),
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    family_id uuid NOT NULL,
    public_user_id uuid NOT NULL,
    channel character varying(16) NOT NULL,
    current_variant_id uuid,
    status character varying(16) NOT NULL DEFAULT 'draft',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id uuid NOT NULL,
    public_user_id uuid NOT NULL,
    locale character varying(10) NOT NULL DEFAULT 'en',
    current_version_id uuid,
    provider_ref character varying(80),
    meta_category character varying(16),
    media_type character varying(16),
    approval_status character varying(20) NOT NULL DEFAULT 'unsubmitted',
    approval_raw_status character varying(40),
    approval_reason text,
    approval_submitted_at timestamp with time zone,
    approval_approved_at timestamp with time zone,
    approval_checked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template_version (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    version integer NOT NULL,
    subject character varying(200),
    body text NOT NULL,
    blocks jsonb,
    blocks_format character varying(16),
    variables text[] NOT NULL DEFAULT '{}',
    provider_ref character varying(80),
    note text,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template_asset (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    public_user_id uuid NOT NULL,
    variant_id uuid,
    kind character varying(16) NOT NULL,
    s3_key text NOT NULL,
    cdn_url text NOT NULL,
    mime character varying(80) NOT NULL,
    bytes bigint NOT NULL,
    width integer, height integer,
    checksum character varying(80),
    is_approval_sample boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_short_link (
    code character varying(16) NOT NULL,
    public_user_id uuid NOT NULL,
    variant_id uuid,
    destination_url text NOT NULL,
    kind character varying(16) NOT NULL,
    expires_at timestamp with time zone,
    click_count bigint NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
