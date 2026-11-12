-- document-service: constraints. Load order comes from scripts/db-files.mjs.

--
-- Name: cash_sale_items cash_sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sale_items
    ADD CONSTRAINT cash_sale_items_pkey PRIMARY KEY (id);



--
-- Name: cash_sale_drafts cash_sale_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sale_drafts
    ADD CONSTRAINT cash_sale_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cash_sale_drafts
    ADD CONSTRAINT cash_sale_drafts_payment_mode_check CHECK (((payment_mode)::text = ANY ((ARRAY['cash'::character varying, 'upi'::character varying, 'upi_qr'::character varying])::text[])));

ALTER TABLE ONLY public.cash_sale_drafts
    ADD CONSTRAINT cash_sale_drafts_items_check CHECK ((jsonb_typeof(items) = 'array'::text));



--
-- Name: cash_sales cash_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sales
    ADD CONSTRAINT cash_sales_pkey PRIMARY KEY (id);



--
-- Name: cash_sales cash_sales_sale_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sales
    ADD CONSTRAINT cash_sales_sale_number_key UNIQUE (sale_number);



--
-- Name: grn_items grn_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_pkey PRIMARY KEY (id);



--
-- Name: grns grns_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_grn_number_key UNIQUE (grn_number);



--
-- Name: grns grns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_pkey PRIMARY KEY (id);



--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);



--
-- Name: invoices invoices_financial_year_sequence_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_financial_year_sequence_number_key UNIQUE (financial_year, sequence_number);



--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);



--
-- Name: invoices invoices_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);



--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);



--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);



--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);



--
-- Name: purchase_orders purchase_orders_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);



--
-- Name: quotation_items quotation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_pkey PRIMARY KEY (id);



--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);



--
-- Name: quotations quotations_quote_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_quote_number_key UNIQUE (quote_number);



--
-- Name: shelf_locations shelf_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_locations
    ADD CONSTRAINT shelf_locations_pkey PRIMARY KEY (id);



--
-- Name: shelf_locations shelf_locations_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_locations
    ADD CONSTRAINT shelf_locations_unique UNIQUE (warehouse_id, aisle_code, rack_code, shelf_code, bin_code);



--
-- Name: shelf_stock_transactions shelf_stock_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock_transactions
    ADD CONSTRAINT shelf_stock_transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.quotations
    ADD CONSTRAINT quotations_customer_response_check CHECK (customer_response IN ('accepted','rejected'));

ALTER TABLE ONLY public.drive_folders
    ADD CONSTRAINT drive_folders_pkey PRIMARY KEY (id);

ALTER TABLE public.drive_folders
    ADD CONSTRAINT drive_folders_visibility_check CHECK (visibility IN ('private','team','shared'));

ALTER TABLE ONLY public.drive_files
    ADD CONSTRAINT drive_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.drive_shares
    ADD CONSTRAINT drive_shares_pkey PRIMARY KEY (id);

ALTER TABLE public.drive_shares
    ADD CONSTRAINT drive_shares_level_check CHECK (level IN ('view','edit','manage'));

ALTER TABLE public.drive_shares
    ADD CONSTRAINT drive_shares_target_check CHECK ((folder_id IS NULL) <> (file_id IS NULL));

ALTER TABLE public.drive_shares
    ADD CONSTRAINT drive_shares_grantee_check CHECK ((grantee_admin_id IS NULL) <> (grantee_role IS NULL));

ALTER TABLE ONLY public.drive_access_log
    ADD CONSTRAINT drive_access_log_pkey PRIMARY KEY (id);



--
-- Name: warehouses warehouses_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_code_unique UNIQUE (code);



--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


-- Migrations: fix shelf_locations FK cascades

ALTER TABLE shelf_stock_transactions ALTER COLUMN location_id DROP NOT NULL;

--
-- po_drafts
--
ALTER TABLE ONLY public.po_drafts
    ADD CONSTRAINT po_drafts_pkey PRIMARY KEY (id);

--
-- po_receive_drafts
--
ALTER TABLE ONLY public.po_receive_drafts
    ADD CONSTRAINT po_receive_drafts_pkey PRIMARY KEY (po_id);

ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_view_token_key UNIQUE (view_token);
ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_type_check CHECK (((type)::text = ANY ((ARRAY['invoice'::character varying, 'quotation'::character varying, 'receipt'::character varying, 'packing_slip'::character varying, 'label'::character varying, 'purchase_order'::character varying])::text[])));
ALTER TABLE ONLY public.document_sequences ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (tenant_id, type, financial_year);
ALTER TABLE ONLY public.document_settings ADD CONSTRAINT document_settings_pkey PRIMARY KEY (tenant_id);
