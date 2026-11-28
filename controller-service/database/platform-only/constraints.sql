-- controller-service: platform-only constraints (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_kind_ref_key UNIQUE (kind, external_ref);
ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_kind_check CHECK (((kind)::text = ANY ((ARRAY['subscription'::character varying, 'wallet_topup'::character varying])::text[])));

ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_pkey PRIMARY KEY (tenant_id, service);
ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_service_check CHECK (((service)::text = ANY ((ARRAY['messaging'::character varying, 'documents'::character varying])::text[])));
ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])));

ALTER TABLE ONLY public.outreach_program_state ADD CONSTRAINT outreach_program_state_pkey PRIMARY KEY (program);
ALTER TABLE ONLY public.outreach_lists ADD CONSTRAINT outreach_lists_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_lists ADD CONSTRAINT outreach_lists_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'google_sheet'::text])));
ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_program_phone_key UNIQUE (program, phone);
ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_status_check CHECK ((status = ANY (ARRAY['new'::text, 'queued'::text, 'calling'::text, 'no_answer'::text, 'callback'::text, 'not_interested'::text, 'wrong_number'::text, 'opted_out'::text, 'interested'::text, 'building'::text, 'preview_sent'::text, 'published'::text, 'claimed'::text, 'dnd'::text, 'failed'::text, 'suppressed'::text])));
ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_dnd_status_check CHECK ((dnd_status = ANY (ARRAY['unknown'::text, 'clear'::text, 'dnd'::text])));
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_provider_call_id_key UNIQUE (provider_call_id);
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'ringing'::text, 'in_progress'::text, 'completed'::text, 'no_answer'::text, 'busy'::text, 'failed'::text, 'voicemail'::text])));
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['interested'::text, 'not_interested'::text, 'callback'::text, 'wrong_number'::text, 'opted_out'::text, 'published'::text, 'incomplete'::text, 'other'::text]))));
ALTER TABLE ONLY public.outreach_messages ADD CONSTRAINT outreach_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_messages ADD CONSTRAINT outreach_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])));
ALTER TABLE ONLY public.outreach_suppressions ADD CONSTRAINT outreach_suppressions_pkey PRIMARY KEY (phone);
ALTER TABLE ONLY public.outreach_events ADD CONSTRAINT outreach_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_skills ADD CONSTRAINT outreach_skills_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_skill_versions ADD CONSTRAINT outreach_skill_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_skill_versions ADD CONSTRAINT outreach_skill_versions_skill_version_key UNIQUE (skill_id, version);
ALTER TABLE ONLY public.outreach_skill_versions ADD CONSTRAINT outreach_skill_versions_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'builtin'::text])));
ALTER TABLE ONLY public.outreach_agent_runs ADD CONSTRAINT outreach_agent_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_agent_runs ADD CONSTRAINT outreach_agent_runs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'handed_off'::text, 'completed'::text, 'stopped'::text])));
ALTER TABLE ONLY public.outreach_agent_tasks ADD CONSTRAINT outreach_agent_tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_agent_tasks ADD CONSTRAINT outreach_agent_tasks_kind_check CHECK ((kind = ANY (ARRAY['call'::text, 'whatsapp_turn'::text])));
ALTER TABLE ONLY public.outreach_agent_tasks ADD CONSTRAINT outreach_agent_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'cancelled'::text, 'failed'::text])));
ALTER TABLE ONLY public.outreach_skills ADD CONSTRAINT outreach_skills_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text])));
ALTER TABLE ONLY public.outreach_skills ADD CONSTRAINT outreach_skills_audience_check CHECK ((audience = ANY (ARRAY['lead'::text, 'shopper'::text])));
ALTER TABLE ONLY public.outreach_skills ADD CONSTRAINT outreach_skills_purpose_check CHECK ((purpose = ANY (ARRAY['transactional'::text, 'promotional'::text])));
ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_kind_check CHECK ((kind = ANY (ARRAY['lead'::text, 'shopper'::text])));
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_source_check CHECK ((source = ANY (ARRAY['csv'::text, 'sheet'::text, 'form'::text, 'api'::text, 'event'::text, 'test'::text])));
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'active'::text, 'waiting'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'handed_off'::text])));
