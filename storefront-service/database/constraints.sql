-- storefront-service: constraints. Load order comes from scripts/db-files.mjs.

--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);



--
-- Name: ai_feedback ai_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback
    ADD CONSTRAINT ai_feedback_pkey PRIMARY KEY (id);


--
-- Name: ai_queries ai_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_queries
    ADD CONSTRAINT ai_queries_pkey PRIMARY KEY (id);



--
-- Name: back_in_stock_notify back_in_stock_notify_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_in_stock_notify
    ADD CONSTRAINT back_in_stock_notify_pkey PRIMARY KEY (id);



--
-- Name: back_in_stock_notify back_in_stock_notify_product_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_in_stock_notify
    ADD CONSTRAINT back_in_stock_notify_product_id_email_key UNIQUE (product_id, email);



--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);



--
-- Name: coupon_usage coupon_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_pkey PRIMARY KEY (id);



--
-- Name: reward_game_plays reward_game_plays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_game_plays
    ADD CONSTRAINT reward_game_plays_pkey PRIMARY KEY (id);



--
-- Name: customer_activity_log customer_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activity_log
    ADD CONSTRAINT customer_activity_log_pkey PRIMARY KEY (id);



--
-- Name: customer_notes customer_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_notes
    ADD CONSTRAINT customer_notes_pkey PRIMARY KEY (id);



--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);



--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);



--
-- Name: page_events page_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_events
    ADD CONSTRAINT page_events_pkey PRIMARY KEY (id);



--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);



--
-- Name: product_views product_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_views
    ADD CONSTRAINT product_views_pkey PRIMARY KEY (id);




--
-- Name: return_requests return_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_adjustment_lines
    ADD CONSTRAINT order_adjustment_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_adjustment_lines
    ADD CONSTRAINT order_adjustment_lines_action_check
    CHECK (action::text = ANY (ARRAY['switch'::text, 'remove'::text, 'quantity'::text]));


--
-- Name: address_change_requests address_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_change_requests
    ADD CONSTRAINT address_change_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.address_change_requests
    ADD CONSTRAINT address_change_requests_status_check
    CHECK (status::text = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));



--
-- Name: review_form_submissions review_form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_form_submissions
    ADD CONSTRAINT review_form_submissions_pkey PRIMARY KEY (id);



--
-- Name: search_logs search_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_logs
    ADD CONSTRAINT search_logs_pkey PRIMARY KEY (id);



--
-- Name: user_search_history user_search_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_search_history
    ADD CONSTRAINT user_search_history_pkey PRIMARY KEY (id);



--
-- Name: users users_email_user_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_user_type_key UNIQUE (email, user_type);



--
-- Name: users users_google_id_user_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_user_type_key UNIQUE (google_id, user_type);



--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);



--
-- Name: users users_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_session_id_key UNIQUE (session_id);



--
-- Name: wishlist_items wishlist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_pkey PRIMARY KEY (id);



--
-- Name: wishlist_items wishlist_items_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: customer_notes customer_notes_source_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.customer_notes
    ADD CONSTRAINT customer_notes_source_check CHECK (((source)::text = ANY ((ARRAY['admin_panel'::character varying, 'staff_form'::character varying])::text[])));


--
-- Name: customer_note_attachments customer_note_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_note_attachments
    ADD CONSTRAINT customer_note_attachments_pkey PRIMARY KEY (id);


--
-- Name: customer_note_attachments customer_note_attachments_kind_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.customer_note_attachments
    ADD CONSTRAINT customer_note_attachments_kind_check CHECK (((kind)::text = ANY ((ARRAY['image'::character varying, 'audio'::character varying])::text[])));


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

--
-- vault_entitlements
--
ALTER TABLE ONLY public.vault_entitlements
    ADD CONSTRAINT vault_entitlements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vault_entitlements
    ADD CONSTRAINT vault_entitlements_order_item_id_key UNIQUE (order_item_id);
ALTER TABLE public.vault_entitlements
    ADD CONSTRAINT vault_entitlements_source_check CHECK (source IN ('one_time','subscription'));
ALTER TABLE public.vault_entitlements
    ADD CONSTRAINT vault_entitlements_status_check CHECK (status IN ('active','revoked'));

--
-- subscription_cycle_orders
--
ALTER TABLE ONLY public.subscription_cycle_orders
    ADD CONSTRAINT subscription_cycle_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscription_cycle_orders
    ADD CONSTRAINT subscription_cycle_orders_sub_cycle_key UNIQUE (subscription_id, cycle_number);
ALTER TABLE ONLY public.subscription_cycle_orders
    ADD CONSTRAINT subscription_cycle_orders_rzp_payment_key UNIQUE (razorpay_payment_id);

--
-- subscription_redemptions (PhonePe Autopay renewals)
--
ALTER TABLE ONLY public.subscription_redemptions
    ADD CONSTRAINT subscription_redemptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscription_redemptions
    ADD CONSTRAINT subscription_redemptions_merchant_order_id_key UNIQUE (merchant_order_id);
ALTER TABLE public.subscription_redemptions
    ADD CONSTRAINT subscription_redemptions_status_check CHECK (status IN ('notifying','notified','executing','completed','failed','cancelled'));

--
-- subscription_plans_cache
--
ALTER TABLE ONLY public.subscription_plans_cache
    ADD CONSTRAINT subscription_plans_cache_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscription_plans_cache
    ADD CONSTRAINT subscription_plans_cache_key UNIQUE (product_id, period, interval_count, amount_paise, collecting_account);

--
-- subscriptions: widened status CHECK (legacy 'active' + Razorpay state machine) + new FKs
--
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_status_check CHECK (status IN (
        'active','created','authenticated','pending','halted','paused','cancelled','completed','expired'));
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_razorpay_subscription_id_key UNIQUE (razorpay_subscription_id);
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_billing_provider_check CHECK (billing_provider IN ('razorpay','phonepe'));
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_phonepe_merchant_subscription_id_key UNIQUE (phonepe_merchant_subscription_id);

--
-- vault_tickets
--
ALTER TABLE ONLY public.vault_tickets
    ADD CONSTRAINT vault_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vault_tickets
    ADD CONSTRAINT vault_tickets_ticket_hash_key UNIQUE (ticket_hash);
ALTER TABLE public.vault_tickets
    ADD CONSTRAINT vault_tickets_principal_type_check CHECK (principal_type IN ('customer','business','vault'));

--
-- user_oauth_identities
--
ALTER TABLE ONLY public.user_oauth_identities
    ADD CONSTRAINT user_oauth_identities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_oauth_identities
    ADD CONSTRAINT user_oauth_identities_provider_subject_user_key UNIQUE (provider, subject, user_id);
ALTER TABLE public.user_oauth_identities
    ADD CONSTRAINT user_oauth_identities_provider_check CHECK (provider IN ('google','facebook','apple','github'));

--
-- vault_access_log (bigint sequence PK)
--
ALTER TABLE ONLY public.vault_access_log
    ADD CONSTRAINT vault_access_log_pkey PRIMARY KEY (id);
ALTER TABLE public.vault_access_log
    ADD CONSTRAINT vault_access_log_action_check CHECK (action IN ('stream','download'));
