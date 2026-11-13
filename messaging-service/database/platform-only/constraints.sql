-- messaging-service: platform-only constraints (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.short_link ADD CONSTRAINT short_link_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.short_link ADD CONSTRAINT short_link_kind_check CHECK (kind IN ('image','page','product'));

ALTER TABLE ONLY public.waba_capacity ADD CONSTRAINT waba_capacity_pkey PRIMARY KEY (waba_id);

ALTER TABLE ONLY public.wa_pricing ADD CONSTRAINT wa_pricing_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wa_pricing ADD CONSTRAINT wa_pricing_source_check CHECK (source IN ('meta','twilio-platform'));
ALTER TABLE ONLY public.wa_pricing ADD CONSTRAINT wa_pricing_country_cat_from_key UNIQUE (country, category, effective_from);

-- ─────────────────────────────────────────────────────────────────────────────
-- Platform messaging-templates catalog (singleton defaults). See database/messaging.sql.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ONLY public.platform_template_family ADD CONSTRAINT platform_template_family_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_template_family ADD CONSTRAINT platform_template_family_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.platform_template ADD CONSTRAINT platform_template_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_template ADD CONSTRAINT platform_template_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE ONLY public.platform_template ADD CONSTRAINT platform_template_status_check CHECK (status IN ('draft','active','archived'));
ALTER TABLE ONLY public.platform_template ADD CONSTRAINT platform_template_family_channel_key UNIQUE (family_id, channel);
ALTER TABLE ONLY public.platform_template_variant ADD CONSTRAINT platform_template_variant_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_template_variant ADD CONSTRAINT platform_template_variant_approval_check CHECK (approval_status IN ('unsubmitted','received','pending','approved','rejected','paused','disabled'));
ALTER TABLE ONLY public.platform_template_variant ADD CONSTRAINT platform_template_variant_locale_key UNIQUE (template_id, locale);
ALTER TABLE ONLY public.platform_template_version ADD CONSTRAINT platform_template_version_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_template_version ADD CONSTRAINT platform_template_version_variant_version_key UNIQUE (variant_id, version);

-- ─────────────────────────────────────────────────────────────────────────────
-- Public-API customer template copies (scoped by public_user_id).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ONLY public.pub_template_family ADD CONSTRAINT pub_template_family_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_family ADD CONSTRAINT pub_template_family_user_slug_key UNIQUE (public_user_id, slug);
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_status_check CHECK (status IN ('draft','active','archived'));
ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_family_channel_key UNIQUE (family_id, channel);
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_approval_check CHECK (approval_status IN ('unsubmitted','received','pending','approved','rejected','paused','disabled'));
ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_locale_key UNIQUE (template_id, locale);
ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_variant_version_key UNIQUE (variant_id, version);
ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_kind_check CHECK (kind IN ('image','video','document'));
ALTER TABLE ONLY public.pub_short_link ADD CONSTRAINT pub_short_link_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.pub_short_link ADD CONSTRAINT pub_short_link_kind_check CHECK (kind IN ('image','page','product'));

ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'sent'::character varying, 'delivered'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])));
ALTER TABLE ONLY public.message_events ADD CONSTRAINT message_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bulk_jobs ADD CONSTRAINT bulk_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bulk_jobs ADD CONSTRAINT bulk_jobs_kind_check CHECK (((kind)::text = ANY ((ARRAY['documents'::character varying, 'messages'::character varying])::text[])));
ALTER TABLE ONLY public.bulk_jobs ADD CONSTRAINT bulk_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'completed'::character varying, 'partial'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])));
ALTER TABLE ONLY public.bulk_job_items ADD CONSTRAINT bulk_job_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bulk_job_items ADD CONSTRAINT bulk_job_items_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'done'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])));
ALTER TABLE ONLY public.messaging_tenant_settings ADD CONSTRAINT messaging_tenant_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY public.messaging_tenant_settings ADD CONSTRAINT messaging_tenant_settings_mode_check CHECK (((standard_templates)::text = ANY ((ARRAY['all'::character varying, 'selected'::character varying])::text[])));
