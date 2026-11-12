-- controller-service: constraints. Load order comes from scripts/db-files.mjs.

--
-- Name: admin_agent_actions admin_agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_actions
    ADD CONSTRAINT admin_agent_actions_pkey PRIMARY KEY (id);



--
-- Name: delhivery_pickup_locations delhivery_pickup_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delhivery_pickup_locations
    ADD CONSTRAINT delhivery_pickup_locations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_kind_ref_key UNIQUE (kind, external_ref);
ALTER TABLE ONLY public.platform_invoices ADD CONSTRAINT platform_invoices_kind_check CHECK (((kind)::text = ANY ((ARRAY['subscription'::character varying, 'wallet_topup'::character varying])::text[])));

ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_pkey PRIMARY KEY (tenant_id, service);
ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_service_check CHECK (((service)::text = ANY ((ARRAY['messaging'::character varying, 'documents'::character varying])::text[])));
ALTER TABLE ONLY public.tenant_service_approvals ADD CONSTRAINT tenant_service_approvals_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])));
