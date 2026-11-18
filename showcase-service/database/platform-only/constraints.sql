-- showcase-service: platform-only constraints (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'live'::character varying, 'paused'::character varying])::text[])));
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_pause_reason_check CHECK (((pause_reason IS NULL) OR ((pause_reason)::text = ANY ((ARRAY['owner'::character varying, 'unpaid'::character varying])::text[]))));
ALTER TABLE ONLY public.showcase_sites ADD CONSTRAINT showcase_sites_slug_check CHECK (((slug)::text ~ '^[a-z0-9](?:[a-z0-9-]{1,56}[a-z0-9])?$'::text));

ALTER TABLE ONLY public.showcase_leads ADD CONSTRAINT showcase_leads_pkey PRIMARY KEY (id);
