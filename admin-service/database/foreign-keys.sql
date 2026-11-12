-- admin-service: foreign-keys. Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.auth_session_keys
    ADD CONSTRAINT auth_session_keys_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id) ON DELETE CASCADE;

-- FKs (order_items / product_variants / product_sub_variants / admins)
ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_order_item_id_fkey
    FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.variant_change_requests
    ADD CONSTRAINT variant_change_requests_requested_by_admin_id_fkey
    FOREIGN KEY (requested_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_requested_by_admin_id_fkey
    FOREIGN KEY (requested_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: admin_agent_conversations admin_agent_conversations_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_conversations
    ADD CONSTRAINT admin_agent_conversations_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: admin_agent_messages admin_agent_messages_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_messages
    ADD CONSTRAINT admin_agent_messages_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admin_agent_proposed_tools admin_agent_proposed_tools_decided_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_proposed_tools
    ADD CONSTRAINT admin_agent_proposed_tools_decided_by_admin_id_fkey FOREIGN KEY (decided_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: admin_agent_proposed_tools admin_agent_proposed_tools_proposed_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_proposed_tools
    ADD CONSTRAINT admin_agent_proposed_tools_proposed_by_admin_id_fkey FOREIGN KEY (proposed_by_admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: admin_certificates admin_certificates_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admin_mfa_recovery_codes admin_mfa_recovery_codes_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_mfa_recovery_codes
    ADD CONSTRAINT admin_mfa_recovery_codes_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admin_saved_views admin_saved_views_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_saved_views
    ADD CONSTRAINT admin_saved_views_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: business_discounts business_discounts_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_discounts
    ADD CONSTRAINT business_discounts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;



--
-- Name: business_discounts business_discounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_discounts
    ADD CONSTRAINT business_discounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: business_profiles business_profiles_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admins(id);



--
-- Name: business_profiles business_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: campaign_send_counts campaign_send_counts_campaign_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_counts
    ADD CONSTRAINT campaign_send_counts_campaign_kind_fkey FOREIGN KEY (campaign_kind) REFERENCES public.campaigns(kind) ON DELETE CASCADE;



--
-- Name: campaign_send_counts campaign_send_counts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_counts
    ADD CONSTRAINT campaign_send_counts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: campaigns campaigns_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;



--
-- Name: campaigns campaigns_scenario_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_scenario_kind_fkey FOREIGN KEY (scenario_kind) REFERENCES public.scenarios(kind) ON DELETE RESTRICT;



--
-- Name: categories categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.categories(id);



--
-- Name: coupon_eligible_users coupon_eligible_users_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_eligible_users
    ADD CONSTRAINT coupon_eligible_users_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;



--
-- Name: coupon_eligible_users coupon_eligible_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_eligible_users
    ADD CONSTRAINT coupon_eligible_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: coupons coupons_generated_for_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_generated_for_user_id_fkey FOREIGN KEY (generated_for_user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: custom_scenarios custom_scenarios_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_scenarios
    ADD CONSTRAINT custom_scenarios_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: custom_scenarios custom_scenarios_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_scenarios
    ADD CONSTRAINT custom_scenarios_kind_fkey FOREIGN KEY (kind) REFERENCES public.scenarios(kind) ON DELETE CASCADE;



--
-- Name: customer_health_history customer_health_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health_history
    ADD CONSTRAINT customer_health_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: customer_health customer_health_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health
    ADD CONSTRAINT customer_health_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: customer_profiles customer_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: customer_tag_definitions customer_tag_definitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_definitions
    ADD CONSTRAINT customer_tag_definitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: customer_tags customer_tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tags
    ADD CONSTRAINT customer_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: customer_tags customer_tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tags
    ADD CONSTRAINT customer_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: customer_tasks customer_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tasks
    ADD CONSTRAINT customer_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: customer_tasks customer_tasks_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tasks
    ADD CONSTRAINT customer_tasks_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: customer_tasks customer_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tasks
    ADD CONSTRAINT customer_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE RESTRICT;



--
-- Name: customer_tasks customer_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tasks
    ADD CONSTRAINT customer_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: email_campaign_logs email_campaign_logs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;



--
-- Name: email_campaigns email_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: email_campaigns_sent email_campaigns_sent_campaign_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns_sent
    ADD CONSTRAINT email_campaigns_sent_campaign_kind_fkey FOREIGN KEY (campaign_kind) REFERENCES public.campaigns(kind) ON DELETE CASCADE;



--
-- Name: email_campaigns_sent email_campaigns_sent_conversion_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns_sent
    ADD CONSTRAINT email_campaigns_sent_conversion_order_id_fkey FOREIGN KEY (conversion_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;



--
-- Name: email_campaigns_sent email_campaigns_sent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns_sent
    ADD CONSTRAINT email_campaigns_sent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: loyalty_accounts loyalty_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: loyalty_ledger loyalty_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: loyalty_ledger loyalty_ledger_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: loyalty_ledger loyalty_ledger_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referrer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_user_id_fkey FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referrals referrals_referred_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_signups referral_signups_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE CASCADE;


--
-- Name: referral_signups referral_signups_referrer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_referrer_user_id_fkey FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_signups referral_signups_referred_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: referral_signups referral_signups_qualifying_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_signups
    ADD CONSTRAINT referral_signups_qualifying_order_id_fkey FOREIGN KEY (qualifying_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;



--
-- Name: email_logs email_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;



--
-- Name: expense_payments expense_payments_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;



--
-- Name: expenses expenses_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id) ON DELETE SET NULL;



--
-- Name: expenses expenses_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;



--
-- Name: failed_login_attempts failed_login_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_login_attempts
    ADD CONSTRAINT failed_login_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: gallery_images gallery_images_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);



--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_devices push_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_devices
    ADD CONSTRAINT push_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_sends push_sends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_sends
    ADD CONSTRAINT push_sends_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.push_sends
    ADD CONSTRAINT push_sends_push_device_id_fkey FOREIGN KEY (push_device_id) REFERENCES public.push_devices(id) ON DELETE CASCADE;


--
-- Name: push_queue push_queue_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_queue
    ADD CONSTRAINT push_queue_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.push_queue
    ADD CONSTRAINT push_queue_push_device_id_fkey FOREIGN KEY (push_device_id) REFERENCES public.push_devices(id) ON DELETE CASCADE;


--
-- Name: email_campaign_logs email_campaign_logs_push_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_push_device_id_fkey FOREIGN KEY (push_device_id) REFERENCES public.push_devices(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;



--
-- Name: orders orders_billing_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_billing_address_id_fkey FOREIGN KEY (billing_address_id) REFERENCES public.addresses(id);



--
-- Name: orders orders_original_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_original_order_id_fkey FOREIGN KEY (original_order_id) REFERENCES public.orders(id);



--
-- Name: orders orders_shipping_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipping_address_id_fkey FOREIGN KEY (shipping_address_id) REFERENCES public.addresses(id);



--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;



--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: price_inflation_log price_inflation_log_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inflation_log
    ADD CONSTRAINT price_inflation_log_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);



--
-- Name: product_ai_enrichment_log product_ai_enrichment_log_decided_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ai_enrichment_log
    ADD CONSTRAINT product_ai_enrichment_log_decided_by_admin_id_fkey FOREIGN KEY (decided_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: product_ai_enrichment_log product_ai_enrichment_log_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ai_enrichment_log
    ADD CONSTRAINT product_ai_enrichment_log_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: product_sub_variants product_sub_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: product_sub_variants product_sub_variants_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;



--
-- Name: product_unit_rules product_unit_rules_product_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_unit_rules
    ADD CONSTRAINT product_unit_rules_product_unit_id_fkey FOREIGN KEY (product_unit_id) REFERENCES public.product_units(id) ON DELETE CASCADE;



--
-- Name: product_units product_units_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: product_units product_units_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;



--
-- Name: product_units product_units_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_units
    ADD CONSTRAINT product_units_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;



--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: product_variants product_variants_sell_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sell_unit_id_fkey FOREIGN KEY (sell_unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;



--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;



--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);



--
-- Name: products products_sell_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sell_unit_id_fkey FOREIGN KEY (sell_unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;



--
-- Name: review_forms review_forms_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;



--
-- Name: scenario_audit_log scenario_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_audit_log
    ADD CONSTRAINT scenario_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: search_queries search_queries_clicked_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_clicked_product_id_fkey FOREIGN KEY (clicked_product_id) REFERENCES public.products(id) ON DELETE SET NULL;



--
-- Name: search_queries search_queries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;



--
-- Name: service_accounts service_accounts_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: service_accounts service_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: shelf_stock shelf_stock_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.shelf_locations(id) ON DELETE CASCADE;



--
-- Name: shelf_stock shelf_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);



--
-- Name: shelf_stock shelf_stock_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;



--
-- Name: shelf_stock shelf_stock_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock
    ADD CONSTRAINT shelf_stock_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;



--
-- Name: site_settings site_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);



--
-- Name: support_messages support_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;



--
-- Name: support_sessions support_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_sessions
    ADD CONSTRAINT support_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_message_attachments
    ADD CONSTRAINT support_message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.support_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_ai_actions
    ADD CONSTRAINT support_ai_actions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reply_context_sends
    ADD CONSTRAINT reply_context_sends_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.reply_contexts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reply_contexts
    ADD CONSTRAINT reply_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



--
-- Name: variant_images variant_images_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_images
    ADD CONSTRAINT variant_images_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;



--
-- Name: websocket_connections websocket_connections_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;



--
-- Name: websocket_connections websocket_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE product_batches DROP CONSTRAINT IF EXISTS product_batches_location_id_fkey;
ALTER TABLE product_batches ADD CONSTRAINT product_batches_location_id_fkey FOREIGN KEY (location_id) REFERENCES shelf_locations(id) ON DELETE SET NULL;


--
-- Name: product_suppliers product_suppliers_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_suppliers product_suppliers_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_suppliers product_suppliers_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;


--
-- Name: product_suppliers product_suppliers_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.product_files
    ADD CONSTRAINT product_files_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- orders.subscription_id FK (new column)
--
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.draft_locks
    ADD CONSTRAINT draft_locks_owner_admin_id_fkey FOREIGN KEY (owner_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.draft_locks
    ADD CONSTRAINT draft_locks_started_by_admin_id_fkey FOREIGN KEY (started_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.draft_locks
    ADD CONSTRAINT draft_locks_previous_owner_admin_id_fkey FOREIGN KEY (previous_owner_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.draft_locks
    ADD CONSTRAINT draft_locks_closed_by_admin_id_fkey FOREIGN KEY (closed_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_recipient_admin_id_fkey FOREIGN KEY (recipient_admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.campaign_drafts
    ADD CONSTRAINT campaign_drafts_kind_fkey FOREIGN KEY (kind) REFERENCES public.campaigns(kind) ON DELETE CASCADE;
ALTER TABLE ONLY public.offer_drafts
    ADD CONSTRAINT offer_drafts_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.product_offers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.amazon_order_items ADD CONSTRAINT amazon_order_items_order_fkey FOREIGN KEY (amazon_order_id) REFERENCES public.amazon_orders(amazon_order_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.amazon_orders ADD CONSTRAINT amazon_orders_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payment_refunds ADD CONSTRAINT payment_refunds_retry_of_fkey FOREIGN KEY (retry_of) REFERENCES public.payment_refunds(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payment_disputes ADD CONSTRAINT payment_disputes_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payment_disputes ADD CONSTRAINT payment_disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_orders ADD CONSTRAINT marketplace_orders_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_order_items ADD CONSTRAINT marketplace_order_items_order_fkey FOREIGN KEY (marketplace_order_id) REFERENCES public.marketplace_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_shipments ADD CONSTRAINT marketplace_shipments_marketplace_order_fkey FOREIGN KEY (marketplace_order_id) REFERENCES public.marketplace_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_shipments ADD CONSTRAINT marketplace_shipments_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_marketplace_order_fkey FOREIGN KEY (marketplace_order_id) REFERENCES public.marketplace_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_returns ADD CONSTRAINT marketplace_returns_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_listings ADD CONSTRAINT marketplace_listings_sub_variant_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_inventory_state ADD CONSTRAINT marketplace_inventory_state_listing_fkey FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_settlement_lines ADD CONSTRAINT marketplace_settlement_lines_settlement_fkey FOREIGN KEY (settlement_id) REFERENCES public.marketplace_settlements(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_settlement_lines ADD CONSTRAINT marketplace_settlement_lines_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

-- product_media / product_faqs
ALTER TABLE ONLY public.product_media ADD CONSTRAINT product_media_root_product_id_fkey FOREIGN KEY (root_product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.product_media ADD CONSTRAINT product_media_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.product_media ADD CONSTRAINT product_media_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.product_media ADD CONSTRAINT product_media_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.product_faqs ADD CONSTRAINT product_faqs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
