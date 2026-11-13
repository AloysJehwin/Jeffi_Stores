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
