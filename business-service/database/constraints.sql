-- business-service: constraints. Load order comes from scripts/db-files.mjs.

--
-- Name: business_rfq_items business_rfq_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfq_items
    ADD CONSTRAINT business_rfq_items_pkey PRIMARY KEY (id);



--
-- Name: business_rfqs business_rfqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_pkey PRIMARY KEY (id);



--
-- Name: business_rfqs business_rfqs_rfq_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_rfq_number_key UNIQUE (rfq_number);



--
-- Name: rfq_messages rfq_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_messages
    ADD CONSTRAINT rfq_messages_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--




--
-- Name: business_rfqs business_rfqs_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'negotiating'::character varying, 'offer_accepted'::character varying, 'converted'::character varying, 'rejected'::character varying])::text[])));
