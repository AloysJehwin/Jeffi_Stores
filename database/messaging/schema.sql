--
-- messaging-service — owned tables (database: jeffi_messaging). Tenant/wallet/api_keys stay in the
-- control plane; this DB only knows tenant_id / api_key_id as opaque uuids.
--
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.message_templates (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id     uuid,                                   -- NULL = system template visible to every tenant
    slug          character varying(80) NOT NULL,         -- 'system/otp', 'welcome-v2'
    channel       character varying(16) NOT NULL,         -- email|sms|whatsapp
    name          character varying(120) NOT NULL,
    subject       character varying(200),                 -- email only
    body          text NOT NULL,                          -- {{var}} tokens; html for email
    variables     text[] NOT NULL DEFAULT '{}',           -- token keys found in subject+body
    provider_ref  character varying(80),                  -- Twilio content SID for approved WhatsApp templates
    status        character varying(16) NOT NULL DEFAULT 'active', -- active|archived
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
    id             uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id      uuid NOT NULL,
    api_key_id     uuid,
    batch_id       uuid,
    channel        character varying(16) NOT NULL,
    to_address     character varying(255) NOT NULL,
    from_address   character varying(255),
    template_slug  character varying(80),
    subject        character varying(200),
    body           text NOT NULL,
    status         character varying(16) NOT NULL DEFAULT 'queued', -- queued|sent|delivered|failed|skipped
    provider       character varying(16),                 -- ses|twilio
    provider_ref   character varying(80),                 -- SES message id / Twilio SID
    price_inr      numeric(10,4) NOT NULL DEFAULT 0,      -- quoted public price
    charged_inr    numeric(10,4) NOT NULL DEFAULT 0,      -- debited (trued-up on callback)
    error          text,
    reference      character varying(120),                -- caller's own id
    metadata       jsonb,
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_events (
    id           uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id   uuid NOT NULL,
    event        character varying(32) NOT NULL,          -- sent|delivered|failed|bounced|complaint|read
    payload      jsonb,
    occurred_at  timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.message_templates ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.message_templates ADD CONSTRAINT message_templates_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE ONLY public.message_templates ADD CONSTRAINT message_templates_status_check CHECK (status IN ('active','archived'));
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_tenant_channel_slug_key ON public.message_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, slug);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_status_check CHECK (status IN ('queued','sent','delivered','failed','skipped'));
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON public.messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_provider_ref ON public.messages (provider_ref);
CREATE INDEX IF NOT EXISTS idx_messages_batch ON public.messages (batch_id);
ALTER TABLE ONLY public.message_events ADD CONSTRAINT message_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.message_events ADD CONSTRAINT message_events_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_message_events_message ON public.message_events (message_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Templates library v2: family → template → variant → version
-- Per-tenant isolated. Admin panel is tenant_id = <ADMIN_TENANT_UUID> constant.
-- The old message_templates stays (public API uses system rows); monolith reads from these.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.template_family (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    slug varchar(80) NOT NULL,
    name varchar(120) NOT NULL,
    category varchar(32),
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    family_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    channel varchar(16) NOT NULL,
    current_variant_id uuid,
    status varchar(16) NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale varchar(10) NOT NULL DEFAULT 'en',
    current_version_id uuid,
    provider_ref varchar(80),
    meta_category varchar(16),
    media_type varchar(16),
    approval_status varchar(20) NOT NULL DEFAULT 'unsubmitted',
    approval_raw_status varchar(40),
    approval_reason text,
    approval_submitted_at timestamptz,
    approval_approved_at timestamptz,
    approval_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_version (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    version int NOT NULL,
    subject varchar(200),
    body text NOT NULL,
    blocks jsonb,
    blocks_format varchar(16),
    variables text[] NOT NULL DEFAULT '{}',
    provider_ref varchar(80),
    note text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_asset (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid,
    kind varchar(16) NOT NULL,
    s3_key text NOT NULL,
    cdn_url text NOT NULL,
    mime varchar(80) NOT NULL,
    bytes bigint NOT NULL,
    width int,
    height int,
    checksum varchar(80),
    is_approval_sample boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_variable (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    key varchar(64) NOT NULL,
    label varchar(120) NOT NULL,
    description text,
    sample_value text,
    source varchar(16) NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS public.brand_theme (
    tenant_id uuid NOT NULL,
    logo_url text,
    primary_color varchar(16),
    accent_color varchar(16),
    font_stack text,
    footer_html text,
    address_html text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_dlt (
    tenant_id uuid NOT NULL,
    entity_id varchar(40),
    default_header varchar(16),
    provider varchar(16) NOT NULL,
    verified boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_dlt_template (
    variant_id uuid NOT NULL,
    dlt_template_id varchar(40) NOT NULL,
    dlt_header varchar(16) NOT NULL,
    dlt_route varchar(16) NOT NULL,
    dlt_approval_status varchar(16) NOT NULL DEFAULT 'pending',
    dlt_notes text
);

CREATE TABLE IF NOT EXISTS public.short_link (
    code varchar(16) NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid,
    campaign_id uuid,
    destination_url text NOT NULL,
    kind varchar(16) NOT NULL,
    expires_at timestamptz,
    click_count bigint NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.waba_capacity (
    waba_id varchar(40) NOT NULL,
    account_sid varchar(40),
    approved_count int NOT NULL DEFAULT 0,
    pending_count int NOT NULL DEFAULT 0,
    last_synced_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.wa_pricing (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    country varchar(2) NOT NULL,
    category varchar(20) NOT NULL,
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    inr_per_message numeric(10,4) NOT NULL,
    source varchar(20) NOT NULL
);

-- PKs
ALTER TABLE ONLY public.template_family ADD CONSTRAINT template_family_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.template ADD CONSTRAINT template_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.template_variant ADD CONSTRAINT template_variant_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.template_version ADD CONSTRAINT template_version_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.template_asset ADD CONSTRAINT template_asset_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.template_variable ADD CONSTRAINT template_variable_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_theme ADD CONSTRAINT brand_theme_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY public.sms_dlt ADD CONSTRAINT sms_dlt_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY public.sms_dlt_template ADD CONSTRAINT sms_dlt_template_pkey PRIMARY KEY (variant_id);
ALTER TABLE ONLY public.short_link ADD CONSTRAINT short_link_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.waba_capacity ADD CONSTRAINT waba_capacity_pkey PRIMARY KEY (waba_id);
ALTER TABLE ONLY public.wa_pricing ADD CONSTRAINT wa_pricing_pkey PRIMARY KEY (id);

-- CHECKs
ALTER TABLE ONLY public.template ADD CONSTRAINT template_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE ONLY public.template ADD CONSTRAINT template_status_check CHECK (status IN ('draft','active','archived'));
ALTER TABLE ONLY public.template_variant ADD CONSTRAINT template_variant_approval_check
  CHECK (approval_status IN ('unsubmitted','received','pending','approved','rejected','paused','disabled'));
ALTER TABLE ONLY public.template_asset ADD CONSTRAINT template_asset_kind_check CHECK (kind IN ('image','video','document'));
ALTER TABLE ONLY public.template_variable ADD CONSTRAINT template_variable_source_check CHECK (source IN ('system','user'));
ALTER TABLE ONLY public.sms_dlt ADD CONSTRAINT sms_dlt_provider_check CHECK (provider IN ('twilio','msg91','kaleyra','gupshup'));
ALTER TABLE ONLY public.sms_dlt_template ADD CONSTRAINT sms_dlt_template_route_check
  CHECK (dlt_route IN ('promotional','transactional','service','otp'));
ALTER TABLE ONLY public.short_link ADD CONSTRAINT short_link_kind_check CHECK (kind IN ('image','page','product'));
ALTER TABLE ONLY public.wa_pricing ADD CONSTRAINT wa_pricing_source_check CHECK (source IN ('meta','twilio-platform'));

-- FKs
ALTER TABLE ONLY public.template ADD CONSTRAINT template_family_fkey
  FOREIGN KEY (family_id) REFERENCES public.template_family(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_variant ADD CONSTRAINT template_variant_template_fkey
  FOREIGN KEY (template_id) REFERENCES public.template(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_version ADD CONSTRAINT template_version_variant_fkey
  FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_asset ADD CONSTRAINT template_asset_variant_fkey
  FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sms_dlt_template ADD CONSTRAINT sms_dlt_template_variant_fkey
  FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE;

-- Uniques
CREATE UNIQUE INDEX IF NOT EXISTS template_family_tenant_slug_key ON public.template_family (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS template_family_channel_key ON public.template (family_id, channel);
CREATE UNIQUE INDEX IF NOT EXISTS template_variant_locale_key ON public.template_variant (template_id, locale);
CREATE UNIQUE INDEX IF NOT EXISTS template_version_variant_version_key ON public.template_version (variant_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS template_variable_tenant_key_key ON public.template_variable (tenant_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS wa_pricing_country_cat_from_key ON public.wa_pricing (country, category, effective_from);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_family_tenant_cat ON public.template_family (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_template_tenant_channel ON public.template (tenant_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_variant_template ON public.template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_variant_approval ON public.template_variant (tenant_id, approval_status) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_version_variant ON public.template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_asset_tenant_kind ON public.template_asset (tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_short_link_tenant ON public.short_link (tenant_id, created_at DESC);
