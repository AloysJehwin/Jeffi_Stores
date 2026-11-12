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
