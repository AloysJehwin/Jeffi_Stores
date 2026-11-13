-- admin-service: constraints. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: _debug_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._debug_log ALTER COLUMN id SET DEFAULT nextval('public._debug_log_id_seq'::regclass);



--
-- Name: merchant_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_sync_log ALTER COLUMN id SET DEFAULT nextval('public.merchant_sync_log_id_seq'::regclass);



--
-- Name: _debug_log _debug_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._debug_log
    ADD CONSTRAINT _debug_log_pkey PRIMARY KEY (id);



--
-- Name: admin_agent_attachments admin_agent_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_attachments
    ADD CONSTRAINT admin_agent_attachments_pkey PRIMARY KEY (id);



--
-- Name: admin_agent_conversations admin_agent_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_conversations
    ADD CONSTRAINT admin_agent_conversations_pkey PRIMARY KEY (id);



--
-- Name: admin_agent_messages admin_agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_messages
    ADD CONSTRAINT admin_agent_messages_pkey PRIMARY KEY (id);



--
-- Name: admin_agent_proposed_tools admin_agent_proposed_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_proposed_tools
    ADD CONSTRAINT admin_agent_proposed_tools_pkey PRIMARY KEY (id);



--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);



--
-- Name: admin_certificates admin_certificates_download_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_download_token_key UNIQUE (download_token);



--
-- Name: admin_certificates admin_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_pkey PRIMARY KEY (id);



--
-- Name: admin_certificates admin_certificates_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_serial_number_key UNIQUE (serial_number);



--
-- Name: admin_mfa_recovery_codes admin_mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_mfa_recovery_codes
    ADD CONSTRAINT admin_mfa_recovery_codes_pkey PRIMARY KEY (id);



--
-- Name: admin_saved_views admin_saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_saved_views
    ADD CONSTRAINT admin_saved_views_pkey PRIMARY KEY (id);


--
-- Name: admin_saved_views admin_saved_views_name_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_saved_views
    ADD CONSTRAINT admin_saved_views_name_check CHECK (((char_length(btrim((name)::text)) >= 1) AND (char_length((name)::text) <= 80)));


--
-- Name: admin_saved_views admin_saved_views_page_key_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_saved_views
    ADD CONSTRAINT admin_saved_views_page_key_check CHECK (((page_key)::text ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'::text));


--
-- Name: admin_saved_views admin_saved_views_query_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_saved_views
    ADD CONSTRAINT admin_saved_views_query_check CHECK ((char_length(query) <= 4000));



--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--
-- One admin record per user. The owner-admin provisioning step upserts with
-- ON CONFLICT (user_id), which needs a matching unique constraint — without it the
-- step failed with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" and no tenant owner could be issued a certificate.
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_key UNIQUE (user_id);




--
-- Name: ai_briefing_log ai_briefing_log_briefing_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_briefing_log
    ADD CONSTRAINT ai_briefing_log_briefing_date_key UNIQUE (briefing_date);



--
-- Name: ai_briefing_log ai_briefing_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_briefing_log
    ADD CONSTRAINT ai_briefing_log_pkey PRIMARY KEY (id);



--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_status_check CHECK (((status)::text = ANY (ARRAY['pending'::text, 'ok'::text, 'failed'::text, 'unpaid'::text])));


--
-- Name: ai_usage ai_usage_capability_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_capability_check CHECK (((capability)::text = ANY (ARRAY['text'::text, 'embed'::text, 'vision'::text, 'image'::text, 'video'::text])));



--
-- Name: brands brands_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_name_key UNIQUE (name);



--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);



--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);



--
-- Name: business_discounts business_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_discounts
    ADD CONSTRAINT business_discounts_pkey PRIMARY KEY (id);



--
-- Name: business_discounts business_discounts_user_id_category_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_discounts
    ADD CONSTRAINT business_discounts_user_id_category_id_key UNIQUE (user_id, category_id);



--
-- Name: business_profiles business_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_pkey PRIMARY KEY (id);



--
-- Name: business_profiles business_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_user_id_key UNIQUE (user_id);


--
-- Name: rfq_reply_drafts rfq_reply_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_reply_drafts
    ADD CONSTRAINT rfq_reply_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rfq_reply_drafts
    ADD CONSTRAINT rfq_reply_drafts_counter_prices_check CHECK ((jsonb_typeof(counter_prices) = 'object'::text));



--
-- Name: campaign_send_counts campaign_send_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_counts
    ADD CONSTRAINT campaign_send_counts_pkey PRIMARY KEY (campaign_kind, user_id);



--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (kind);



--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);



--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);



--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);



--
-- Name: categories categories_reorder_interval_days_check; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_reorder_interval_days_check CHECK (reorder_interval_days IS NULL OR (reorder_interval_days >= 1 AND reorder_interval_days <= 365));



--
-- Name: coupon_eligible_users coupon_eligible_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_eligible_users
    ADD CONSTRAINT coupon_eligible_users_pkey PRIMARY KEY (coupon_id, user_id);



--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);



--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);



--
-- Name: custom_scenarios custom_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_scenarios
    ADD CONSTRAINT custom_scenarios_pkey PRIMARY KEY (kind);


--
-- Name: scenario_drafts scenario_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_drafts
    ADD CONSTRAINT scenario_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.scenario_drafts
    ADD CONSTRAINT scenario_drafts_fields_check CHECK ((jsonb_typeof(fields) = 'object'::text));



--
-- Name: customer_health_history customer_health_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health_history
    ADD CONSTRAINT customer_health_history_pkey PRIMARY KEY (id);



--
-- Name: customer_health customer_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health
    ADD CONSTRAINT customer_health_pkey PRIMARY KEY (user_id);



--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);



--
-- Name: customer_tag_definitions customer_tag_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_definitions
    ADD CONSTRAINT customer_tag_definitions_pkey PRIMARY KEY (id);



--
-- Name: customer_tag_definitions customer_tag_definitions_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_definitions
    ADD CONSTRAINT customer_tag_definitions_tag_key UNIQUE (tag);



--
-- Name: customer_tags customer_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tags
    ADD CONSTRAINT customer_tags_pkey PRIMARY KEY (id);



--
-- Name: customer_tags customer_tags_user_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tags
    ADD CONSTRAINT customer_tags_user_id_tag_key UNIQUE (user_id, tag);



--
-- Name: customer_tasks customer_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tasks
    ADD CONSTRAINT customer_tasks_pkey PRIMARY KEY (id);


--
-- Name: delhivery_pickup_requests delhivery_pickup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delhivery_pickup_requests
    ADD CONSTRAINT delhivery_pickup_requests_pkey PRIMARY KEY (id);



--
-- Name: email_campaign_logs email_campaign_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_channel_check CHECK (channel IN ('email','sms','whatsapp','push'));



--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);



--
-- Name: email_campaigns_sent email_campaigns_sent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns_sent
    ADD CONSTRAINT email_campaigns_sent_pkey PRIMARY KEY (id);



--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: message_logs message_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_pkey PRIMARY KEY (id);



--
-- Name: expense_payments expense_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_pkey PRIMARY KEY (id);



--
-- Name: expenses expenses_expense_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_expense_number_key UNIQUE (expense_number);



--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);



--
-- Name: account_deletions account_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletions
    ADD CONSTRAINT account_deletions_pkey PRIMARY KEY (id);



--
-- Name: account_deletions account_deletions_requested_via_check; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletions
    ADD CONSTRAINT account_deletions_requested_via_check CHECK (requested_via IN ('app', 'web', 'admin'));



--
-- Name: failed_login_attempts failed_login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_login_attempts
    ADD CONSTRAINT failed_login_attempts_pkey PRIMARY KEY (id);



--
-- Name: gallery_images gallery_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_media_kind_check CHECK (media_kind IN ('image')) NOT VALID;

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_source_check CHECK (source IN ('upload','ai','import')) NOT VALID;



--
-- Name: merchant_sync_log merchant_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_sync_log
    ADD CONSTRAINT merchant_sync_log_pkey PRIMARY KEY (id);



--
-- Name: merchant_gmc_status merchant_gmc_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_gmc_status
    ADD CONSTRAINT merchant_gmc_status_pkey PRIMARY KEY (offer_id);


--
-- Name: merchant_gmc_refresh_meta merchant_gmc_refresh_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_gmc_refresh_meta
    ADD CONSTRAINT merchant_gmc_refresh_meta_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.merchant_gmc_refresh_meta
    ADD CONSTRAINT merchant_gmc_refresh_meta_key_key UNIQUE (key);


--
-- Name: amazon_sync_log amazon_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amazon_sync_log
    ADD CONSTRAINT amazon_sync_log_pkey PRIMARY KEY (id);


--
-- Name: amazon_listing_status amazon_listing_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amazon_listing_status
    ADD CONSTRAINT amazon_listing_status_pkey PRIMARY KEY (sku);


--
-- Name: amazon_refresh_meta amazon_refresh_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amazon_refresh_meta
    ADD CONSTRAINT amazon_refresh_meta_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.amazon_refresh_meta
    ADD CONSTRAINT amazon_refresh_meta_singleton CHECK (id = 1);


--
-- Name: ads_account ads_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_account
    ADD CONSTRAINT ads_account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_account
    ADD CONSTRAINT ads_account_singleton CHECK (id = 1);

ALTER TABLE ONLY public.ads_account
    ADD CONSTRAINT ads_account_conversion_upload_api_check CHECK (((conversion_upload_api)::text = ANY ((ARRAY['data_manager'::character varying, 'ads_api'::character varying])::text[])));

--
-- Name: ads_campaigns ads_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_campaigns
    ADD CONSTRAINT ads_campaigns_pkey PRIMARY KEY (campaign_id);


--
-- Name: ads_experiments ads_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_experiments
    ADD CONSTRAINT ads_experiments_pkey PRIMARY KEY (experiment_id);


--
-- Name: ads_campaign_drafts ads_campaign_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_campaign_drafts
    ADD CONSTRAINT ads_campaign_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_campaign_drafts
    ADD CONSTRAINT ads_campaign_drafts_fields_check CHECK ((jsonb_typeof(fields) = 'object'::text));

--
-- Name: ads_ad_groups ads_ad_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_ad_groups
    ADD CONSTRAINT ads_ad_groups_pkey PRIMARY KEY (ad_group_id);

--
-- Name: ads_ads ads_ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_ads
    ADD CONSTRAINT ads_ads_pkey PRIMARY KEY (ad_group_id, ad_id);

--
-- Name: ads_keywords ads_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_keywords
    ADD CONSTRAINT ads_keywords_pkey PRIMARY KEY (ad_group_id, criterion_id);

--
-- Name: ads_daily_metrics ads_daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_daily_metrics
    ADD CONSTRAINT ads_daily_metrics_pkey PRIMARY KEY (date, campaign_id, ad_group_id, device, network);

--
-- Name: ads_product_metrics ads_product_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_product_metrics
    ADD CONSTRAINT ads_product_metrics_pkey PRIMARY KEY (date, campaign_id, item_id);

--
-- Name: ads_search_terms ads_search_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_search_terms
    ADD CONSTRAINT ads_search_terms_pkey PRIMARY KEY (date, campaign_id, ad_group_id, search_term);

--
-- Name: ads_geo_metrics ads_geo_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_geo_metrics
    ADD CONSTRAINT ads_geo_metrics_pkey PRIMARY KEY (date, location);

--
-- Name: ads_recommendations ads_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_recommendations
    ADD CONSTRAINT ads_recommendations_pkey PRIMARY KEY (resource_name);

--
-- Name: ads_change_events ads_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_change_events
    ADD CONSTRAINT ads_change_events_pkey PRIMARY KEY (resource_name);

--
-- Name: ads_change_log ads_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_change_log
    ADD CONSTRAINT ads_change_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_change_log
    ADD CONSTRAINT ads_change_log_status_check CHECK (((status)::text = ANY ((ARRAY['applied'::character varying, 'rejected'::character varying, 'failed'::character varying])::text[])));

--
-- Name: ads_sync_log ads_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_sync_log
    ADD CONSTRAINT ads_sync_log_pkey PRIMARY KEY (id);

--
-- Name: ads_conversion_uploads ads_conversion_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_conversion_uploads
    ADD CONSTRAINT ads_conversion_uploads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_conversion_uploads
    ADD CONSTRAINT ads_conversion_uploads_order_kind_version_key UNIQUE (order_id, kind, version);

ALTER TABLE ONLY public.ads_conversion_uploads
    ADD CONSTRAINT ads_conversion_uploads_kind_check CHECK (((kind)::text = ANY ((ARRAY['purchase'::character varying, 'retraction'::character varying, 'restatement'::character varying])::text[])));

ALTER TABLE ONLY public.ads_conversion_uploads
    ADD CONSTRAINT ads_conversion_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'uploaded'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])));

--
-- Name: ads_conversion_requests ads_conversion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_conversion_requests
    ADD CONSTRAINT ads_conversion_requests_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.ads_conversion_requests
    ADD CONSTRAINT ads_conversion_requests_kind_check CHECK (((kind)::text = ANY ((ARRAY['purchase'::character varying, 'adjustment'::character varying])::text[])));

ALTER TABLE ONLY public.ads_conversion_requests
    ADD CONSTRAINT ads_conversion_requests_status_check CHECK (((status)::text = ANY ((ARRAY['PROCESSING'::character varying, 'SUCCESS'::character varying, 'PARTIAL_SUCCESS'::character varying, 'FAILED'::character varying, 'UNKNOWN'::character varying, 'TIMED_OUT'::character varying])::text[])));

--
-- Name: ads_audiences ads_audiences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_audiences
    ADD CONSTRAINT ads_audiences_pkey PRIMARY KEY (segment);

ALTER TABLE ONLY public.ads_audiences
    ADD CONSTRAINT ads_audiences_segment_check CHECK (((segment)::text = ANY ((ARRAY['repeat_buyers'::character varying, 'lapsed'::character varying, 'high_value'::character varying, 'recent_buyers'::character varying, 'b2b'::character varying])::text[])));

--
-- Name: ads_audience_members ads_audience_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_audience_members
    ADD CONSTRAINT ads_audience_members_pkey PRIMARY KEY (segment, user_id);

--
-- Name: ads_alerts ads_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_alerts
    ADD CONSTRAINT ads_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_alerts
    ADD CONSTRAINT ads_alerts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'dismissed'::character varying, 'resolved'::character varying])::text[])));

ALTER TABLE ONLY public.ads_alerts
    ADD CONSTRAINT ads_alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])));


--
-- Name: homepage_draft_branches homepage_draft_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homepage_draft_branches
    ADD CONSTRAINT homepage_draft_branches_pkey PRIMARY KEY (id);


--
-- Name: homepage_sections homepage_sections_type_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
-- Kept out of CREATE TABLE so existing tenants pick up new section types (see catalog.sql).
--

ALTER TABLE ONLY public.homepage_sections
    ADD CONSTRAINT homepage_sections_type_check CHECK ((type = ANY (ARRAY[
        'hero'::text, 'offer_slider'::text, 'trust_strip'::text, 'category_grid'::text, 'brand_carousel'::text,
        'product_row'::text, 'category_showcase'::text, 'deal_of_the_day'::text,
        'promo_banner'::text, 'featured_for_you'::text, 'benefits'::text,
        'why_us'::text, 'about'::text, 'business_cta'::text,
        'countdown_deal'::text, 'testimonials'::text, 'recently_viewed'::text, 'category_tabs'::text,
        'bundle_spotlight'::text, 'back_in_stock'::text, 'blog_teaser'::text, 'social_strip'::text,
        'value_stats'::text, 'motion_hero'::text, 'stories'::text, 'product_spotlight'::text,
        'rewards_game'::text, 'slides'::text, 'business_reorder'::text, 'business_quotes'::text,
        'business_offers'::text, 'business_account'::text])));


--
-- Name: homepage_sections homepage_sections_surface_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
-- IS NOT NULL is spelled out: the fan-out adds the column to existing tables without NOT NULL.
--

ALTER TABLE ONLY public.homepage_sections
    ADD CONSTRAINT homepage_sections_surface_check CHECK ((surface IS NOT NULL AND (surface)::text = ANY (ARRAY['web'::text, 'web_mobile'::text, 'app'::text])));


--
-- Name: homepage_sections homepage_sections_page_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homepage_sections
    ADD CONSTRAINT homepage_sections_page_check CHECK ((page IS NOT NULL AND (page)::text = ANY (ARRAY['home'::text, 'products'::text, 'category'::text, 'brand'::text])));


--
-- Name: homepage_sections homepage_sections_audience_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
-- The business audience has a homepage only.
--

ALTER TABLE ONLY public.homepage_sections
    ADD CONSTRAINT homepage_sections_audience_check CHECK ((audience IS NOT NULL AND ((audience)::text = 'store'::text OR ((audience)::text = 'business'::text AND (page)::text = 'home'::text))));


--
-- Name: hero_slides hero_slides_surface_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_slides
    ADD CONSTRAINT hero_slides_surface_check CHECK ((surface IS NOT NULL AND (surface)::text = ANY (ARRAY['web'::text, 'web_mobile'::text, 'app'::text])));


--
-- Name: hero_slides hero_slides_audience_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_slides
    ADD CONSTRAINT hero_slides_audience_check CHECK ((audience IS NOT NULL AND (audience)::text = ANY (ARRAY['store'::text, 'business'::text])));




--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_category_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
-- NULL-safe: the fan-out adds these columns to existing tables without NOT NULL.
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_category_check CHECK ((category IS NULL OR (category)::text = ANY (ARRAY['orders'::text, 'account'::text, 'offers'::text, 'price_alerts'::text])));

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_source_check CHECK ((source IS NULL OR (source)::text = ANY (ARRAY['transactional'::text, 'campaign'::text, 'scenario'::text])));


--
-- Name: push_devices push_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_devices
    ADD CONSTRAINT push_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.push_devices
    ADD CONSTRAINT push_devices_token_key UNIQUE (token);

ALTER TABLE ONLY public.push_devices
    ADD CONSTRAINT push_devices_platform_check CHECK ((platform IS NULL OR (platform)::text = ANY (ARRAY['android'::text, 'ios'::text])));


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, category);

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_category_check CHECK ((category IS NULL OR (category)::text = ANY (ARRAY['orders'::text, 'account'::text, 'offers'::text, 'price_alerts'::text])));


--
-- Name: push_sends push_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_sends
    ADD CONSTRAINT push_sends_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.push_sends
    ADD CONSTRAINT push_sends_source_check CHECK (((source)::text = ANY (ARRAY['campaign'::text, 'scenario'::text])));

ALTER TABLE ONLY public.push_sends
    ADD CONSTRAINT push_sends_target_check CHECK (((user_id IS NOT NULL) OR (push_device_id IS NOT NULL)));


--
-- Name: push_queue push_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_queue
    ADD CONSTRAINT push_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.push_queue
    ADD CONSTRAINT push_queue_notification_device_key UNIQUE (notification_id, push_device_id);


--
-- Name: admin_notifications admin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);



--
-- Name: entity_revisions entity_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_revisions
    ADD CONSTRAINT entity_revisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.entity_revisions
    ADD CONSTRAINT entity_revisions_resource_revision_key UNIQUE (resource_type, resource_id, revision);



--
-- Name: orders orders_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_invoice_number_key UNIQUE (invoice_number);



--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);



--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);



--
-- Name: otp_verifications otp_verifications_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_email_key UNIQUE (email);



--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);



--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);



--
-- Name: payments payments_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_transaction_id_key UNIQUE (transaction_id);



--
-- Name: price_inflation_log price_inflation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inflation_log
    ADD CONSTRAINT price_inflation_log_pkey PRIMARY KEY (id);



--
-- Name: product_ai_enrichment_log product_ai_enrichment_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ai_enrichment_log
    ADD CONSTRAINT product_ai_enrichment_log_pkey PRIMARY KEY (id);



--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);



--
-- Name: product_sub_variants product_sub_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_pkey PRIMARY KEY (id);



--
-- Name: product_sub_variants product_sub_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_sku_key UNIQUE (sku);



--
-- Name: product_unit_rules product_unit_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_unit_rules
    ADD CONSTRAINT product_unit_rules_pkey PRIMARY KEY (id);



--
-- Name: product_units product_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_pkey PRIMARY KEY (id);



--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);



--
-- Name: product_variants product_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);



--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);



--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);



--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: variant_change_requests variant_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_settlement_type_check
    CHECK (settlement_type::text = ANY (ARRAY['refund'::text, 'collect'::text, 'cod_adjust'::text, 'none'::text]));

--
-- Name: order_adjustments order_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_settlement_type_check
    CHECK (settlement_type::text = ANY (ARRAY['refund'::text, 'collect'::text, 'cod_adjust'::text, 'none'::text]));

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_status_check
    CHECK (status::text = ANY (ARRAY['pending_customer'::text, 'awaiting_payment'::text, 'applied'::text, 'rejected'::text, 'cancelled'::text]));

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_refund_status_check
    CHECK (refund_status IS NULL OR refund_status::text = ANY (ARRAY['pending'::text, 'refunded'::text]));

ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_status_check
    CHECK (status::text = ANY (ARRAY['pending_customer'::text, 'awaiting_payment'::text, 'applied'::text, 'rejected'::text, 'cancelled'::text]));



--
-- Name: review_forms review_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_pkey PRIMARY KEY (id);



--
-- Name: review_forms review_forms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_slug_key UNIQUE (slug);



--
-- Name: scenario_audit_log scenario_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_audit_log
    ADD CONSTRAINT scenario_audit_log_pkey PRIMARY KEY (id);



--
-- Name: scenarios scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_pkey PRIMARY KEY (kind);



--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);



--
-- Name: search_queries search_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_pkey PRIMARY KEY (id);



--
-- Name: service_accounts service_accounts_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_name_key UNIQUE (name);



--
-- Name: service_accounts service_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_pkey PRIMARY KEY (id);



--
-- Name: service_accounts service_accounts_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_serial_number_key UNIQUE (serial_number);



--
-- Name: shelf_stock shelf_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_pkey PRIMARY KEY (id);



--
-- Name: shelf_stock shelf_stock_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_unique UNIQUE (location_id, product_id, variant_id, sub_variant_id);



--
-- Name: shipping_zones shipping_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_pkey PRIMARY KEY (id);



--
-- Name: site_settings site_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_key_key UNIQUE (key);



--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);



--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);



--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);



--
-- Name: support_sessions support_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_sessions
    ADD CONSTRAINT support_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_sessions
    ADD CONSTRAINT support_sessions_ticket_number_key UNIQUE (ticket_number);

ALTER TABLE public.support_sessions
    ADD CONSTRAINT support_sessions_handler_check CHECK (handler IN ('ai','human'));

ALTER TABLE ONLY public.support_message_attachments
    ADD CONSTRAINT support_message_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_ai_actions
    ADD CONSTRAINT support_ai_actions_pkey PRIMARY KEY (id);

ALTER TABLE public.support_ai_actions
    ADD CONSTRAINT support_ai_actions_status_check CHECK (status IN ('pending','confirmed','declined','done','failed','expired'));

ALTER TABLE public.support_ai_actions
    ADD CONSTRAINT support_ai_actions_awaiting_check CHECK (awaiting IN ('customer','admin','none'));

--
-- Name: reply_contexts reply_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_contexts
    ADD CONSTRAINT reply_contexts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reply_contexts
    ADD CONSTRAINT reply_contexts_token_key UNIQUE (token);

ALTER TABLE public.reply_contexts
    ADD CONSTRAINT reply_contexts_status_check CHECK (status IN ('open','answered','closed','expired'));

ALTER TABLE ONLY public.reply_context_sends
    ADD CONSTRAINT reply_context_sends_pkey PRIMARY KEY (id);


--
-- Name: template_variables template_variables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_variables
    ADD CONSTRAINT template_variables_pkey PRIMARY KEY (id);


--
-- Name: template_variables template_variables_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_variables
    ADD CONSTRAINT template_variables_key_key UNIQUE (key);


--
-- Name: template_variables template_variables_key_check; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_variables
    ADD CONSTRAINT template_variables_key_check CHECK (((key)::text ~ '^[a-z_][a-z0-9_]*$'::text));



--
-- Name: variant_images variant_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_images
    ADD CONSTRAINT variant_images_pkey PRIMARY KEY (id);



--
-- Name: websocket_connections websocket_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_pkey PRIMARY KEY (connection_id);


--
-- Name: product_suppliers product_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_pkey PRIMARY KEY (id);


--
-- Name: product_suppliers product_suppliers_unit_cost_nonneg; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.product_suppliers
    ADD CONSTRAINT product_suppliers_unit_cost_nonneg CHECK (unit_cost >= 0);


--
-- Name: product_suppliers product_suppliers_one_leaf; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--
-- Supplier attaches at exactly one leaf: at most one of variant_id / sub_variant_id set.

ALTER TABLE public.product_suppliers
    ADD CONSTRAINT product_suppliers_one_leaf CHECK (NOT (variant_id IS NOT NULL AND sub_variant_id IS NOT NULL));


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_principal_type_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.auth_sessions
    ADD CONSTRAINT auth_sessions_principal_type_check CHECK (((principal_type)::text = ANY ((ARRAY['admin'::character varying, 'customer'::character varying, 'business'::character varying, 'owner'::character varying, 'vault'::character varying])::text[])));


--
-- Name: auth_session_keys auth_session_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session_keys
    ADD CONSTRAINT auth_session_keys_pkey PRIMARY KEY (session_id);

--
-- Name: product_units product_units_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_check CHECK (((max_qty IS NULL) OR (max_qty >= min_qty)));

--
-- Name: product_units product_units_min_qty_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_min_qty_check CHECK ((min_qty > (0)::numeric));

--
-- Name: product_units product_units_qty_step_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_qty_step_check CHECK ((qty_step > (0)::numeric));


--
-- Name: offer_display_settings offer_display_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_display_settings
    ADD CONSTRAINT offer_display_settings_pkey PRIMARY KEY (offer_id);


--
-- Name: loyalty_accounts loyalty_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_pkey PRIMARY KEY (user_id);


--
-- Name: loyalty_ledger loyalty_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_reason_check
    CHECK (reason::text = ANY (ARRAY['order_earn'::text, 'order_reversal'::text, 'redeem'::text, 'redeem_refund'::text, 'adjustment'::text, 'referral'::text, 'referral_reversal'::text]));


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_code_key UNIQUE (referral_code);


--
-- Name: referrals referrals_referrer_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_unique UNIQUE (referrer_user_id);


--
-- Name: referral_signups referral_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_pkey PRIMARY KEY (id);


--
-- Name: referral_signups referral_signups_referred_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_referred_unique UNIQUE (referred_user_id);


--
-- Name: referral_signups referral_signups_status_check; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_status_check
    CHECK (status::text = ANY (ARRAY['joined'::text, 'rewarded'::text, 'reversed'::text, 'capped'::text, 'rejected'::text]));


-- =====================================================================
-- Digital products, vault & customer subscriptions (added together)
-- =====================================================================

--
-- product_files
--
ALTER TABLE ONLY public.product_files
    ADD CONSTRAINT product_files_pkey PRIMARY KEY (id);
ALTER TABLE public.product_files
    ADD CONSTRAINT product_files_kind_check CHECK (kind IN ('video','audio','pdf','image','other'));
ALTER TABLE public.product_files
    ADD CONSTRAINT product_files_status_check CHECK (status IN ('uploading','processing','ready','failed'));
ALTER TABLE public.product_files
    ADD CONSTRAINT product_files_storage_driver_check CHECK (storage_driver IN ('s3','local'));

--
-- products: digital products carry no variants
--
ALTER TABLE public.products
    ADD CONSTRAINT products_digital_no_variants_check CHECK (NOT (is_digital AND COALESCE(has_variants, false)));

--
-- products: subscription cycle limits (NULL = until cancelled / no commitment)
--
ALTER TABLE public.products
    ADD CONSTRAINT products_subscription_total_cycles_check CHECK (subscription_total_cycles IS NULL OR subscription_total_cycles > 0);
ALTER TABLE public.products
    ADD CONSTRAINT products_subscription_min_cycles_check CHECK (subscription_min_cycles IS NULL OR subscription_min_cycles > 0);

--
-- upload_sessions
--
ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.upload_sessions
    ADD CONSTRAINT upload_sessions_status_check CHECK (status IN ('open','completed','aborted'));

--
-- Name: editor_sessions editor_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--
ALTER TABLE ONLY public.editor_sessions
    ADD CONSTRAINT editor_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.editor_sessions
    ADD CONSTRAINT editor_sessions_closed_reason_check
    CHECK (closed_reason IN ('save','cancel','expired','superseded') OR closed_reason IS NULL);

--
-- draft_locks / draft_presence
--
ALTER TABLE ONLY public.draft_locks
    ADD CONSTRAINT draft_locks_pkey PRIMARY KEY (resource_type, resource_id);
ALTER TABLE public.draft_locks
    ADD CONSTRAINT draft_locks_acquired_via_check
    CHECK (acquired_via IN ('start','claim','handover','takeover','backfill'));
ALTER TABLE public.draft_locks
    ADD CONSTRAINT draft_locks_closed_reason_check
    CHECK (closed_reason IN ('published','discarded','finalized','sent','converted','deleted','orphaned') OR closed_reason IS NULL);
ALTER TABLE public.draft_locks
    ADD CONSTRAINT draft_locks_takeover_reason_check
    CHECK (acquired_via <> 'takeover' OR takeover_reason IS NOT NULL);
ALTER TABLE ONLY public.draft_presence
    ADD CONSTRAINT draft_presence_pkey PRIMARY KEY (resource_type, resource_id, admin_id, tab_id);
ALTER TABLE public.draft_presence
    ADD CONSTRAINT draft_presence_mode_check CHECK (mode IN ('view','edit'));

--
-- campaign_drafts
--
ALTER TABLE ONLY public.campaign_drafts
    ADD CONSTRAINT campaign_drafts_pkey PRIMARY KEY (campaign_id);

--
-- offer_drafts
--
ALTER TABLE ONLY public.offer_drafts
    ADD CONSTRAINT offer_drafts_pkey PRIMARY KEY (id);

--
-- site_control_drafts
--
ALTER TABLE ONLY public.site_control_drafts
    ADD CONSTRAINT site_control_drafts_pkey PRIMARY KEY (admin_id, scope);

ALTER TABLE ONLY public.channel_sync_log ADD CONSTRAINT channel_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.channel_sync_log ADD CONSTRAINT channel_sync_log_channel_check CHECK (((channel)::text = ANY ((ARRAY['gmc'::character varying, 'amazon'::character varying, 'amazon_ads'::character varying, 'meta_ads'::character varying, 'social'::character varying, 'razorpay'::character varying, 'myntra'::character varying, 'ajio'::character varying, 'myntra_ads'::character varying, 'ajio_ads'::character varying])::text[])));
ALTER TABLE ONLY public.channel_sync_log ADD CONSTRAINT channel_sync_log_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'success'::character varying, 'partial'::character varying, 'error'::character varying])::text[])));
ALTER TABLE ONLY public.channel_alerts ADD CONSTRAINT channel_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.channel_alerts ADD CONSTRAINT channel_alerts_channel_check CHECK (((channel)::text = ANY ((ARRAY['gmc'::character varying, 'amazon'::character varying, 'amazon_ads'::character varying, 'meta_ads'::character varying, 'social'::character varying, 'razorpay'::character varying, 'myntra'::character varying, 'ajio'::character varying, 'myntra_ads'::character varying, 'ajio_ads'::character varying])::text[])));
ALTER TABLE ONLY public.channel_alerts ADD CONSTRAINT channel_alerts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'dismissed'::character varying, 'resolved'::character varying])::text[])));
ALTER TABLE ONLY public.channel_alerts ADD CONSTRAINT channel_alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])));
ALTER TABLE ONLY public.channel_change_log ADD CONSTRAINT channel_change_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.channel_change_log ADD CONSTRAINT channel_change_log_status_check CHECK (((status)::text = ANY ((ARRAY['applied'::character varying, 'rejected'::character varying, 'failed'::character varying])::text[])));

ALTER TABLE ONLY public.gmc_product_performance ADD CONSTRAINT gmc_product_performance_pkey PRIMARY KEY (date, offer_id, marketing_method);
ALTER TABLE ONLY public.gmc_price_competitiveness ADD CONSTRAINT gmc_price_competitiveness_pkey PRIMARY KEY (offer_id);
ALTER TABLE ONLY public.gmc_price_insights ADD CONSTRAINT gmc_price_insights_pkey PRIMARY KEY (offer_id);
ALTER TABLE ONLY public.gmc_best_sellers ADD CONSTRAINT gmc_best_sellers_pkey PRIMARY KEY (report_date, category_id, rank);
ALTER TABLE ONLY public.gmc_best_sellers ADD CONSTRAINT gmc_best_sellers_catalog_status_check CHECK (((catalog_status)::text = ANY ((ARRAY['in_stock'::character varying, 'out_of_stock'::character varying, 'not_listed'::character varying, 'not_carried'::character varying])::text[])));
ALTER TABLE ONLY public.gmc_account_issues ADD CONSTRAINT gmc_account_issues_pkey PRIMARY KEY (name);
ALTER TABLE ONLY public.gmc_issue_cache ADD CONSTRAINT gmc_issue_cache_pkey PRIMARY KEY (offer_id);
ALTER TABLE ONLY public.gmc_account_state ADD CONSTRAINT gmc_account_state_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.gmc_account_state ADD CONSTRAINT gmc_account_state_single CHECK ((id = 1));

ALTER TABLE ONLY public.amazon_offers ADD CONSTRAINT amazon_offers_pkey PRIMARY KEY (sku);
ALTER TABLE ONLY public.amazon_fee_estimates ADD CONSTRAINT amazon_fee_estimates_pkey PRIMARY KEY (sku);
ALTER TABLE ONLY public.amazon_repricer_rules ADD CONSTRAINT amazon_repricer_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.amazon_repricer_rules ADD CONSTRAINT amazon_repricer_rules_strategy_check CHECK (((strategy)::text = ANY ((ARRAY['match_buybox'::character varying, 'beat_buybox'::character varying, 'hold'::character varying])::text[])));

ALTER TABLE ONLY public.amazon_orders ADD CONSTRAINT amazon_orders_pkey PRIMARY KEY (amazon_order_id);
ALTER TABLE ONLY public.amazon_orders ADD CONSTRAINT amazon_orders_stock_state_check CHECK (((stock_state)::text = ANY ((ARRAY['none'::character varying, 'deducted'::character varying, 'restored'::character varying, 'short'::character varying, 'unmatched'::character varying])::text[])));
ALTER TABLE ONLY public.amazon_order_items ADD CONSTRAINT amazon_order_items_pkey PRIMARY KEY (order_item_id);
ALTER TABLE ONLY public.amazon_inventory_state ADD CONSTRAINT amazon_inventory_state_pkey PRIMARY KEY (sku);

ALTER TABLE ONLY public.amazon_report_requests ADD CONSTRAINT amazon_report_requests_pkey PRIMARY KEY (report_id);
ALTER TABLE ONLY public.amazon_sales_traffic_daily ADD CONSTRAINT amazon_sales_traffic_daily_pkey PRIMARY KEY (date);
ALTER TABLE ONLY public.amazon_sales_traffic_asin ADD CONSTRAINT amazon_sales_traffic_asin_pkey PRIMARY KEY (asin);
ALTER TABLE ONLY public.amazon_settlements ADD CONSTRAINT amazon_settlements_pkey PRIMARY KEY (settlement_id);

ALTER TABLE ONLY public.aads_profile ADD CONSTRAINT aads_profile_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.aads_profile ADD CONSTRAINT aads_profile_single CHECK ((id = 1));
ALTER TABLE ONLY public.aads_campaigns ADD CONSTRAINT aads_campaigns_pkey PRIMARY KEY (campaign_id);
ALTER TABLE ONLY public.aads_ad_groups ADD CONSTRAINT aads_ad_groups_pkey PRIMARY KEY (ad_group_id);
ALTER TABLE ONLY public.aads_keywords ADD CONSTRAINT aads_keywords_pkey PRIMARY KEY (keyword_id);
ALTER TABLE ONLY public.aads_product_ads ADD CONSTRAINT aads_product_ads_pkey PRIMARY KEY (ad_id);
ALTER TABLE ONLY public.aads_daily_metrics ADD CONSTRAINT aads_daily_metrics_pkey PRIMARY KEY (date, campaign_id);
ALTER TABLE ONLY public.aads_search_terms ADD CONSTRAINT aads_search_terms_pkey PRIMARY KEY (date, campaign_id, ad_group_id, keyword_id, search_term);
ALTER TABLE ONLY public.aads_product_metrics ADD CONSTRAINT aads_product_metrics_pkey PRIMARY KEY (date, campaign_id, ad_group_id, sku);
ALTER TABLE ONLY public.aads_report_requests ADD CONSTRAINT aads_report_requests_pkey PRIMARY KEY (report_id);

ALTER TABLE ONLY public.mads_account ADD CONSTRAINT mads_account_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mads_account ADD CONSTRAINT mads_account_single CHECK ((id = 1));
ALTER TABLE ONLY public.mads_campaigns ADD CONSTRAINT mads_campaigns_pkey PRIMARY KEY (campaign_id);
ALTER TABLE ONLY public.mads_adsets ADD CONSTRAINT mads_adsets_pkey PRIMARY KEY (adset_id);
ALTER TABLE ONLY public.mads_ads ADD CONSTRAINT mads_ads_pkey PRIMARY KEY (ad_id);
ALTER TABLE ONLY public.mads_daily_metrics ADD CONSTRAINT mads_daily_metrics_pkey PRIMARY KEY (date, ad_id);
ALTER TABLE ONLY public.mads_breakdowns ADD CONSTRAINT mads_breakdowns_pkey PRIMARY KEY (dimension, key);
ALTER TABLE ONLY public.mads_capi_events ADD CONSTRAINT mads_capi_events_pkey PRIMARY KEY (order_id, event_name);
ALTER TABLE ONLY public.mads_capi_events ADD CONSTRAINT mads_capi_events_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])));

ALTER TABLE ONLY public.gallery_videos
    ADD CONSTRAINT gallery_videos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gallery_videos
    ADD CONSTRAINT gallery_videos_source_check CHECK (source IN ('upload','ai','import')) NOT VALID;

ALTER TABLE ONLY public.ai_prompt_presets
    ADD CONSTRAINT ai_prompt_presets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_prompt_presets
    ADD CONSTRAINT ai_prompt_presets_kind_check CHECK (kind IN ('image','video')) NOT VALID;

ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_gateway_account_check CHECK (gateway_account IS NULL OR gateway_account IN ('platform','own')) NOT VALID;
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_dispute_status_check CHECK (dispute_status IS NULL OR dispute_status IN ('open','under_review','won','lost','closed')) NOT VALID;

ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_razorpay_refund_id_key UNIQUE (razorpay_refund_id);
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_status_check CHECK (status IN ('pending','processed','failed'));
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_initiated_by_check CHECK (initiated_by IN ('app','dashboard','dispute','retry'));

ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_merchant_order_id_key UNIQUE (merchant_order_id);
ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_provider_check CHECK (provider IN ('phonepe','upg'));
ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_purpose_check CHECK (purpose IN ('order_draft','order','order_adjustment','variant_change','wallet_topup','ecom_wallet_topup'));
ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_status_check CHECK (status IN ('pending','queued','active','processing','awaiting_confirmation','completed','failed','expired','cancelled','rejected'));
ALTER TABLE ONLY public.upi_bank_observations ADD CONSTRAINT upi_bank_observations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.upi_bank_observations ADD CONSTRAINT upi_bank_observations_fingerprint_key UNIQUE (fingerprint);
ALTER TABLE ONLY public.upi_bank_observations ADD CONSTRAINT upi_bank_observations_kind_check CHECK (kind IN ('credit','gmail_forwarding'));
ALTER TABLE ONLY public.upi_payment_intents ADD CONSTRAINT upi_payment_intents_amount_check CHECK (amount_paise > 0);

ALTER TABLE ONLY public.payment_disputes ADD CONSTRAINT payment_disputes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_disputes ADD CONSTRAINT payment_disputes_razorpay_dispute_id_key UNIQUE (razorpay_dispute_id);
ALTER TABLE ONLY public.payment_disputes ADD CONSTRAINT payment_disputes_status_check CHECK (status IN ('open','under_review','won','lost','closed'));

ALTER TABLE ONLY public.razorpay_settlements ADD CONSTRAINT razorpay_settlements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.razorpay_settlements ADD CONSTRAINT razorpay_settlements_account_check CHECK (account IN ('platform','own'));
ALTER TABLE ONLY public.razorpay_settlement_items ADD CONSTRAINT razorpay_settlement_items_pkey PRIMARY KEY (settlement_id, entity_id);
ALTER TABLE ONLY public.razorpay_settlement_items ADD CONSTRAINT razorpay_settlement_items_scope_check CHECK (scope IN ('order','other_store','platform_billing','adjustment','unmatched'));

-- Marketplaces (database/marketplace.sql).
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_channel_order_key UNIQUE (channel, external_order_id);
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_status_check CHECK (status IN ('created','accepted','packed','ready_to_dispatch','shipped','delivered','cancelled','rejected','returned'));
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_stock_state_check CHECK (stock_state IN ('none','deducted','restored','short','unmatched'));
ALTER TABLE ONLY public.marketplace_order_items ADD CONSTRAINT marketplace_order_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_order_items ADD CONSTRAINT marketplace_order_items_unit_key UNIQUE (marketplace_order_id, external_line_id, unit_index);
ALTER TABLE ONLY public.marketplace_order_items ADD CONSTRAINT marketplace_order_items_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_order_items ADD CONSTRAINT marketplace_order_items_matched_by_check CHECK (matched_by IS NULL OR matched_by IN ('listing','sub_variant','variant','product'));
ALTER TABLE ONLY public.marketplace_shipments ADD CONSTRAINT marketplace_shipments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_shipments ADD CONSTRAINT marketplace_shipments_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_channel_return_key UNIQUE (channel, external_return_id);
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_type_check CHECK (return_type IN ('customer','rto'));
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_status_check CHECK (status IN ('initiated','in_transit','received','qc_passed','qc_failed','closed','cancelled'));
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_status_check CHECK (status IN ('unmapped','mapped','submitted','live','rejected','inactive'));
ALTER TABLE ONLY public.marketplace_listing_tasks ADD CONSTRAINT marketplace_listing_tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_listing_tasks ADD CONSTRAINT marketplace_listing_tasks_channel_task_key UNIQUE (channel, task_id);
ALTER TABLE ONLY public.marketplace_listing_tasks ADD CONSTRAINT marketplace_listing_tasks_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_listing_tasks ADD CONSTRAINT marketplace_listing_tasks_kind_check CHECK (kind IN ('submit','update','delete'));
ALTER TABLE ONLY public.marketplace_listing_tasks ADD CONSTRAINT marketplace_listing_tasks_status_check CHECK (status IN ('pending','processing','done','partial','failed'));
ALTER TABLE ONLY public.marketplace_inventory_state ADD CONSTRAINT marketplace_inventory_state_pkey PRIMARY KEY (channel, marketplace_sku, warehouse_id);
ALTER TABLE ONLY public.marketplace_inventory_state ADD CONSTRAINT marketplace_inventory_state_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_webhook_events ADD CONSTRAINT marketplace_webhook_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_webhook_events ADD CONSTRAINT marketplace_webhook_events_channel_key_key UNIQUE (channel, event_key);
ALTER TABLE ONLY public.marketplace_webhook_events ADD CONSTRAINT marketplace_webhook_events_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_webhook_events ADD CONSTRAINT marketplace_webhook_events_source_check CHECK (source IN ('push','mock','poll','manual'));
ALTER TABLE ONLY public.marketplace_webhook_events ADD CONSTRAINT marketplace_webhook_events_status_check CHECK (status IN ('pending','done','ignored','failed'));
ALTER TABLE ONLY public.marketplace_settlements ADD CONSTRAINT marketplace_settlements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_settlements ADD CONSTRAINT marketplace_settlements_channel_ref_key UNIQUE (channel, settlement_ref);
ALTER TABLE ONLY public.marketplace_settlements ADD CONSTRAINT marketplace_settlements_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_settlements ADD CONSTRAINT marketplace_settlements_source_check CHECK (source IN ('upload','api'));
ALTER TABLE ONLY public.marketplace_settlement_lines ADD CONSTRAINT marketplace_settlement_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_settlement_lines ADD CONSTRAINT marketplace_settlement_lines_channel_check CHECK (channel IN ('amazon','myntra','ajio'));
ALTER TABLE ONLY public.marketplace_settlement_lines ADD CONSTRAINT marketplace_settlement_lines_type_check CHECK (line_type IN ('sale','refund','fee','commission','tax','adjustment','other'));

-- Marketplace ads (database/marketplace-ads.sql).
ALTER TABLE ONLY public.marketplace_ad_daily ADD CONSTRAINT marketplace_ad_daily_pkey PRIMARY KEY (channel, date, campaign_key, ad_group);
ALTER TABLE ONLY public.marketplace_ad_daily ADD CONSTRAINT marketplace_ad_daily_channel_check CHECK (channel IN ('myntra','ajio'));
ALTER TABLE ONLY public.marketplace_ad_products ADD CONSTRAINT marketplace_ad_products_pkey PRIMARY KEY (channel, date, campaign_key, product_key);
ALTER TABLE ONLY public.marketplace_ad_products ADD CONSTRAINT marketplace_ad_products_channel_check CHECK (channel IN ('myntra','ajio'));
ALTER TABLE ONLY public.marketplace_ad_imports ADD CONSTRAINT marketplace_ad_imports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_ad_imports ADD CONSTRAINT marketplace_ad_imports_channel_check CHECK (channel IN ('myntra','ajio'));
ALTER TABLE ONLY public.marketplace_ad_imports ADD CONSTRAINT marketplace_ad_imports_kind_check CHECK (kind IN ('campaign','product'));

ALTER TABLE ONLY public.setup_guide_progress ADD CONSTRAINT setup_guide_progress_pkey PRIMARY KEY (step_id);
ALTER TABLE ONLY public.setup_guide_progress ADD CONSTRAINT setup_guide_progress_state_check CHECK (state IN ('applied','approved','skipped'));

-- product_media / product_faqs
ALTER TABLE ONLY public.product_media ADD CONSTRAINT product_media_pkey PRIMARY KEY (id);
ALTER TABLE public.product_media ADD CONSTRAINT product_media_owner_check CHECK (num_nonnulls(product_id, variant_id, sub_variant_id) = 1);
ALTER TABLE public.product_media ADD CONSTRAINT product_media_kind_check CHECK (kind IN ('image','video','external_video','document','model_3d','spin_360','audio'));
ALTER TABLE public.product_media ADD CONSTRAINT product_media_status_check CHECK (status IN ('processing','ready','failed'));
ALTER TABLE ONLY public.product_faqs ADD CONSTRAINT product_faqs_pkey PRIMARY KEY (id);

-- brand / category profile (docs/BRAND_CATEGORY_PLAN.md)
ALTER TABLE ONLY public.category_faqs ADD CONSTRAINT category_faqs_pkey PRIMARY KEY (id);
ALTER TABLE public.brands ADD CONSTRAINT brands_brand_type_check CHECK (brand_type IN ('manufacturer','private_label','distributor','white_label'));
ALTER TABLE public.brands ADD CONSTRAINT brands_brand_color_check CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE public.categories ADD CONSTRAINT categories_listing_layout_check CHECK (listing_layout IN ('grid','table'));
ALTER TABLE public.categories ADD CONSTRAINT categories_default_gst_rate_check CHECK (default_gst_rate IS NULL OR (default_gst_rate >= 0 AND default_gst_rate <= 100));
ALTER TABLE ONLY public.entity_ai_enrichment_log ADD CONSTRAINT entity_ai_enrichment_log_pkey PRIMARY KEY (id);
ALTER TABLE public.entity_ai_enrichment_log ADD CONSTRAINT entity_ai_enrichment_log_type_check CHECK (entity_type IN ('brand','category'));
ALTER TABLE public.entity_ai_enrichment_log ADD CONSTRAINT entity_ai_enrichment_log_status_check CHECK (status IN ('proposed','approved','rejected','failed'));
