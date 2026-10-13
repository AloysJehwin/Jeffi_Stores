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

-- NOTE: The tenant-facing templates library (template_family / template / template_variant / template_version,
-- plus template_asset, brand_theme, sms_dlt, short_link, waba_capacity, wa_pricing) lives in the PER-TENANT DB,
-- not here. See database/messaging.sql (topic file) + database/constraints.sql + database/indexes.sql.
-- jeffi_messaging keeps only service-local tables (public-API message_templates for pub-API customers,
-- send log, events). The monolith reads templates from the tenant's own DB via messaging-service with the
-- tenant_id in the service-auth claim.


-- ─────────────────────────────────────────────────────────────────────────────
-- Public-API customer templates library (scoped by public_user_id).
-- Same shape as the per-tenant tables, but under a messaging-service-local scope
-- because public-API customers do NOT get their own DB (store tenants do).
-- Copied from jeffi_control_plane.platform_template_* on public-user signup.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pub_template_family (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    public_user_id uuid NOT NULL,
    slug varchar(80) NOT NULL,
    name varchar(120) NOT NULL,
    category varchar(32),
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    family_id uuid NOT NULL,
    public_user_id uuid NOT NULL,
    channel varchar(16) NOT NULL,
    current_variant_id uuid,
    status varchar(16) NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_template_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    template_id uuid NOT NULL,
    public_user_id uuid NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.pub_template_version (
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

CREATE TABLE IF NOT EXISTS public.pub_template_asset (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    public_user_id uuid NOT NULL,
    variant_id uuid,
    kind varchar(16) NOT NULL,
    s3_key text NOT NULL,
    cdn_url text NOT NULL,
    mime varchar(80) NOT NULL,
    bytes bigint NOT NULL,
    width int, height int,
    checksum varchar(80),
    is_approval_sample boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pub_short_link (
    code varchar(16) NOT NULL,
    public_user_id uuid NOT NULL,
    variant_id uuid,
    destination_url text NOT NULL,
    kind varchar(16) NOT NULL,
    expires_at timestamptz,
    click_count bigint NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ONLY public.pub_template_family ADD CONSTRAINT pub_template_family_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_family ADD CONSTRAINT pub_template_family_user_slug_key UNIQUE (public_user_id, slug);
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_status_check CHECK (status IN ('draft','active','archived'));
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_family_channel_key UNIQUE (family_id, channel);
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_family_fkey FOREIGN KEY (family_id) REFERENCES public.pub_template_family(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_approval_check
  CHECK (approval_status IN ('unsubmitted','received','pending','approved','rejected','paused','disabled'));
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_locale_key UNIQUE (template_id, locale);
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_template_fkey FOREIGN KEY (template_id) REFERENCES public.pub_template(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_variant_version_key UNIQUE (variant_id, version);
ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.pub_template_variant(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_kind_check CHECK (kind IN ('image','video','document'));
ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.pub_template_variant(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pub_short_link ADD CONSTRAINT pub_short_link_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.pub_short_link ADD CONSTRAINT pub_short_link_kind_check CHECK (kind IN ('image','page','product'));

CREATE INDEX IF NOT EXISTS idx_pub_family_user_cat ON public.pub_template_family (public_user_id, category);
CREATE INDEX IF NOT EXISTS idx_pub_template_user_channel ON public.pub_template (public_user_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_pub_variant_template ON public.pub_template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_pub_version_variant ON public.pub_template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pub_asset_user_kind ON public.pub_template_asset (public_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_pub_short_link_user ON public.pub_short_link (public_user_id, created_at DESC);
