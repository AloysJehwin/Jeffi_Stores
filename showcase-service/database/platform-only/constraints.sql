-- showcase-service: platform-only constraints (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'live'::character varying, 'paused'::character varying])::text[])));
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_pause_reason_check CHECK (((pause_reason IS NULL) OR ((pause_reason)::text = ANY ((ARRAY['owner'::character varying, 'unpaid'::character varying])::text[]))));
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_slug_check CHECK (((slug)::text ~ '^[a-z0-9](?:[a-z0-9-]{1,56}[a-z0-9])?$'::text));

ALTER TABLE ONLY public.showcase_leads ADD CONSTRAINT showcase_leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.showcase_sessions ADD CONSTRAINT showcase_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.showcase_sessions ADD CONSTRAINT showcase_sessions_site_session_key UNIQUE (site_id, session_id);
ALTER TABLE ONLY public.showcase_sessions ADD CONSTRAINT showcase_sessions_max_scroll_check CHECK (((max_scroll >= 0) AND (max_scroll <= 100)));

ALTER TABLE ONLY public.showcase_events ADD CONSTRAINT showcase_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.showcase_events ADD CONSTRAINT showcase_events_type_check CHECK (((type)::text = ANY ((ARRAY['pageview'::character varying, 'click'::character varying, 'form_start'::character varying, 'form_submit'::character varying])::text[])));
ALTER TABLE ONLY public.showcase_events ADD CONSTRAINT showcase_events_target_check CHECK (((target IS NULL) OR ((target)::text = ANY ((ARRAY['call'::character varying, 'whatsapp'::character varying, 'email'::character varying, 'map'::character varying, 'social'::character varying, 'link'::character varying])::text[]))));
