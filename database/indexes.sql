-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: cart_items_upsert_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cart_items_upsert_key ON public.cart_items USING btree (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(sub_variant_id, '00000000-0000-0000-0000-000000000000'::uuid), buy_mode);



--
-- Name: idx_aapt_name_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_aapt_name_active ON public.admin_agent_proposed_tools USING btree (name) WHERE (status = 'approved'::text);



--
-- Name: idx_aapt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aapt_status ON public.admin_agent_proposed_tools USING btree (status, created_at DESC);



--
-- Name: idx_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_user_id ON public.addresses USING btree (user_id);



--
-- Name: idx_amazon_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_amazon_orders_order_id ON public.amazon_orders USING btree (order_id) WHERE (order_id IS NOT NULL);



--
-- Name: idx_admin_agent_actions_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_actions_admin ON public.admin_agent_actions USING btree (admin_id, proposed_at DESC);



--
-- Name: idx_admin_agent_actions_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_actions_conv ON public.admin_agent_actions USING btree (conversation_id, proposed_at DESC);



--
-- Name: idx_admin_agent_actions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_actions_status ON public.admin_agent_actions USING btree (status, proposed_at DESC);



--
-- Name: idx_admin_agent_attachments_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_attachments_admin ON public.admin_agent_attachments USING btree (admin_id, created_at DESC);



--
-- Name: idx_admin_agent_attachments_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_attachments_expiry ON public.admin_agent_attachments USING btree (expires_at);



--
-- Name: idx_admin_agent_messages_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_messages_admin ON public.admin_agent_messages USING btree (admin_id, created_at DESC);



--
-- Name: idx_admin_agent_messages_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_agent_messages_conv ON public.admin_agent_messages USING btree (conversation_id, created_at);



--
-- Name: idx_admin_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_action ON public.admin_audit_log USING btree (action, created_at DESC);



--
-- Name: idx_admin_audit_admin_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_admin_created ON public.admin_audit_log USING btree (admin_id, created_at DESC);



--
-- Name: idx_admin_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_entity ON public.admin_audit_log USING btree (entity_type, entity_id, created_at DESC);



--
-- Name: idx_admin_certs_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_admin_id ON public.admin_certificates USING btree (admin_id);



--
-- Name: idx_admin_certs_download_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_download_token ON public.admin_certificates USING btree (download_token);



--
-- Name: idx_admin_certs_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_serial ON public.admin_certificates USING btree (serial_number);



--
-- Name: idx_admin_mfa_recovery_codes_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_mfa_recovery_codes_admin_id ON public.admin_mfa_recovery_codes USING btree (admin_id) WHERE (used_at IS NULL);



--
-- Name: idx_admin_saved_views_admin_page_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_admin_saved_views_admin_page_name ON public.admin_saved_views USING btree (admin_id, page_key, lower((name)::text));



--
-- Name: idx_admin_saved_views_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_saved_views_shared ON public.admin_saved_views USING btree (page_key) WHERE is_shared;



--
-- Name: idx_ai_briefing_log_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_briefing_log_date ON public.ai_briefing_log USING btree (briefing_date DESC);



--
-- Name: idx_ai_feedback_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_feedback_dedupe ON public.ai_feedback USING btree (ai_query_id, COALESCE((product_id)::text, ''::text), signal);



--
-- Name: idx_ai_feedback_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_feedback_query ON public.ai_feedback USING btree (ai_query_id);



--
-- Name: idx_ai_feedback_signal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_feedback_signal ON public.ai_feedback USING btree (signal, created_at DESC);



--
-- Name: idx_ai_feedback_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_feedback_user_recent ON public.ai_feedback USING btree (user_id, created_at DESC);



--
-- Name: idx_ai_queries_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_queries_recent ON public.ai_queries USING btree (created_at DESC) WHERE (error IS NULL);



--
-- Name: idx_ai_queries_recommended_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_queries_recommended_user ON public.ai_queries USING gin (recommended_product_ids) WHERE (recommended_count > 0);



--
-- Name: idx_ai_queries_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_queries_user_time ON public.ai_queries USING btree (user_id, created_at DESC);


--
-- Name: idx_ai_usage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_created ON public.ai_usage USING btree (created_at DESC);


--
-- Name: idx_ai_usage_feature_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_feature_created ON public.ai_usage USING btree (feature, created_at DESC);



--
-- Name: idx_back_in_stock_notify_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_back_in_stock_notify_product ON public.back_in_stock_notify USING btree (product_id) WHERE (notified = false);



--
-- Name: idx_business_discounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_discounts_user_id ON public.business_discounts USING btree (user_id);



--
-- Name: idx_business_profiles_approval_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_profiles_approval_status ON public.business_profiles USING btree (approval_status);



--
-- Name: idx_business_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_profiles_user_id ON public.business_profiles USING btree (user_id);



--
-- Name: idx_business_rfq_items_rfq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_rfq_items_rfq_id ON public.business_rfq_items USING btree (rfq_id);



--
-- Name: idx_business_rfq_items_sub_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_rfq_items_sub_variant_id ON public.business_rfq_items USING btree (sub_variant_id);



--
-- Name: idx_business_rfqs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_rfqs_status ON public.business_rfqs USING btree (status);



--
-- Name: idx_business_rfqs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_rfqs_user_id ON public.business_rfqs USING btree (user_id);



--
-- Name: idx_campaign_send_counts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_send_counts_user ON public.campaign_send_counts USING btree (user_id);



--
-- Name: idx_campaigns_scenario_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_scenario_kind ON public.campaigns USING btree (scenario_kind);



--
-- Name: idx_cart_items_user_saved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_items_user_saved ON public.cart_items USING btree (user_id, saved_for_later);



--
-- Name: idx_cart_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_user_id ON public.cart_items USING btree (user_id);



--
-- Name: idx_cash_sale_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_product_id ON public.cash_sale_items USING btree (product_id);



--
-- Name: idx_cash_sale_items_sale_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_sale_id ON public.cash_sale_items USING btree (sale_id);



--
-- Name: idx_cash_sales_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_invoice_date ON public.cash_sales USING btree (invoice_date);



--
-- Name: idx_cash_sales_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_invoice_number ON public.cash_sales USING btree (invoice_number);



--
-- Name: idx_cash_sales_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_search_vector ON public.cash_sales USING gin (search_vector);



--
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_category_id);



--
-- Name: idx_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_slug ON public.categories USING btree (slug);



--
-- Name: idx_ceu_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ceu_user_id ON public.coupon_eligible_users USING btree (user_id);



--
-- Name: idx_coupon_usage_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_order_id ON public.coupon_usage USING btree (order_id);



--
-- Name: idx_coupons_generated_for; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_generated_for ON public.coupons USING btree (generated_for_user_id, generated_for_campaign) WHERE (auto_generated = true);



--
-- Name: reward_game_plays_game_user_period_key; Type: INDEX; Schema: public; Owner: -
-- The play limit: one row per user per game per period, enforced by ON CONFLICT DO NOTHING.
--

CREATE UNIQUE INDEX reward_game_plays_game_user_period_key ON public.reward_game_plays USING btree (game_key, user_id, period_key);



--
-- Name: idx_custom_scenarios_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_scenarios_enabled ON public.custom_scenarios USING btree (enabled) WHERE (enabled = true);



--
-- Name: idx_customer_activity_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activity_kind ON public.customer_activity_log USING btree (kind, created_at DESC);



--
-- Name: idx_customer_activity_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activity_user_created ON public.customer_activity_log USING btree (user_id, created_at DESC);



--
-- Name: idx_customer_health_history_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_health_history_user_time ON public.customer_health_history USING btree (user_id, snapshot_at DESC);



--
-- Name: idx_customer_health_last_computed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_health_last_computed ON public.customer_health USING btree (last_computed_at);



--
-- Name: idx_customer_health_risk_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_health_risk_score ON public.customer_health USING btree (churn_risk, score);



--
-- Name: idx_customer_health_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_health_score ON public.customer_health USING btree (score);



--
-- Name: idx_customer_health_trend_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_health_trend_30d ON public.customer_health USING btree (trend_delta_30d) WHERE (trend_delta_30d < '-10'::integer);



--
-- Name: idx_customer_notes_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_notes_user_created ON public.customer_notes USING btree (user_id, created_at DESC);


--
-- Name: idx_customer_notes_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_notes_order ON public.customer_notes USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_customer_notes_return_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_notes_return_request ON public.customer_notes USING btree (return_request_id) WHERE (return_request_id IS NOT NULL);


--
-- Name: idx_customer_notes_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_notes_shared ON public.customer_notes USING btree (user_id, created_at DESC) WHERE (shared_with_customer = true);


--
-- Name: idx_customer_note_attachments_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_note_attachments_note ON public.customer_note_attachments USING btree (note_id, display_order);



--
-- Name: idx_customer_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_profiles_user_id ON public.customer_profiles USING btree (user_id);



--
-- Name: idx_customer_tag_defs_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tag_defs_tag ON public.customer_tag_definitions USING btree (tag);



--
-- Name: idx_customer_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tags_tag ON public.customer_tags USING btree (tag);



--
-- Name: idx_customer_tags_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tags_user ON public.customer_tags USING btree (user_id);



--
-- Name: idx_customer_tasks_assigned_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tasks_assigned_status_due ON public.customer_tasks USING btree (assigned_to, status, due_date) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[]));



--
-- Name: idx_customer_tasks_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tasks_source ON public.customer_tasks USING btree (source_kind, source_ref_id);



--
-- Name: idx_customer_tasks_source_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customer_tasks_source_open ON public.customer_tasks USING btree (source_kind, source_ref_id) WHERE ((source_kind IS NOT NULL) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[])));



--
-- Name: idx_customer_tasks_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tasks_status_due ON public.customer_tasks USING btree (status, due_date) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[]));



--
-- Name: idx_customer_tasks_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tasks_user_status ON public.customer_tasks USING btree (user_id, status);



--
-- Name: idx_debug_log_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debug_log_ts ON public._debug_log USING btree (ts DESC);



--
-- Name: idx_delhivery_pickup_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delhivery_pickup_requests_created_at ON public.delhivery_pickup_requests USING btree (created_at DESC);


--
-- Name: uq_delhivery_pickup_locations_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_delhivery_pickup_locations_tenant_name ON public.delhivery_pickup_locations USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), name);


--
-- Name: idx_delhivery_pickup_locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delhivery_pickup_locations_tenant ON public.delhivery_pickup_locations USING btree (tenant_id);



--
-- Name: idx_email_campaign_logs_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaign_logs_campaign ON public.email_campaign_logs USING btree (campaign_id);

CREATE UNIQUE INDEX idx_email_campaign_logs_push_device ON public.email_campaign_logs USING btree (campaign_id, push_device_id) WHERE (push_device_id IS NOT NULL);

CREATE INDEX idx_email_campaign_logs_push_due ON public.email_campaign_logs USING btree (send_after) WHERE ((channel)::text = 'push'::text AND (status)::text = ANY (ARRAY['queued'::text, 'deferred'::text]));



--
-- Name: idx_email_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaigns_status ON public.email_campaigns USING btree (status);



--
-- Name: idx_email_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_entity ON public.email_logs USING btree (entity_type, entity_id);



--
-- Name: idx_email_logs_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_kind ON public.email_logs USING btree (kind);



--
-- Name: idx_email_logs_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_sent_at ON public.email_logs USING btree (sent_at DESC);


--
-- Name: idx_message_logs_channel_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_logs_channel_sent_at ON public.message_logs USING btree (channel, sent_at DESC);


--
-- Name: idx_message_logs_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_logs_kind ON public.message_logs USING btree (kind);



--
-- Name: idx_message_logs_provider_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_logs_provider_sid ON public.message_logs USING btree (provider_sid);



--
-- Name: idx_email_logs_status_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_status_sent_at ON public.email_logs USING btree (status, sent_at DESC);



--
-- Name: idx_email_sent_campaign_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sent_campaign_user ON public.email_campaigns_sent USING btree (campaign_kind, user_id, sent_at DESC);



--
-- Name: idx_email_sent_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sent_channel ON public.email_campaigns_sent USING btree (campaign_kind, user_id, channel, sent_at DESC);



--
-- Name: idx_email_sent_clicked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sent_clicked ON public.email_campaigns_sent USING btree (user_id, clicked_at DESC) WHERE ((clicked_at IS NOT NULL) AND (converted_at IS NULL));



--
-- Name: idx_email_sent_dedup_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_sent_dedup_open ON public.email_campaigns_sent USING btree (campaign_kind, user_id, COALESCE(reference_id, ''::character varying)) WHERE ((unsubscribed_at IS NULL) AND (bounced_at IS NULL) AND (complained_at IS NULL));



--
-- Name: idx_email_sent_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sent_user_recent ON public.email_campaigns_sent USING btree (user_id, sent_at DESC);



--
-- Name: idx_expense_payments_expense_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_payments_expense_id ON public.expense_payments USING btree (expense_id);



--
-- Name: idx_expense_payments_payout_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_payments_payout_id ON public.expense_payments USING btree (payout_id);



--
-- Name: idx_expenses_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_due_date ON public.expenses USING btree (due_date);



--
-- Name: idx_expenses_grn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_grn_id ON public.expenses USING btree (grn_id);



--
-- Name: idx_expenses_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_po_id ON public.expenses USING btree (po_id);



--
-- Name: idx_expenses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_status ON public.expenses USING btree (status);



--
-- Name: idx_account_deletions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_deletions_user ON public.account_deletions USING btree (user_id);



--
-- Name: idx_failed_login_email_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_login_email_time ON public.failed_login_attempts USING btree (email, created_at DESC);



--
-- Name: idx_failed_login_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_login_user_time ON public.failed_login_attempts USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);



--
-- Name: idx_gallery_images_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_images_created ON public.gallery_images USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gallery_images_tenant_created ON public.gallery_images USING btree (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gallery_images_tenant_source ON public.gallery_images USING btree (tenant_id, source);



--
-- Name: idx_grn_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_po ON public.grns USING btree (po_id);



--
-- Name: idx_inv_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_created_at ON public.inventory_transactions USING btree (created_at DESC);



--
-- Name: idx_inv_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_product_id ON public.inventory_transactions USING btree (product_id);



--
-- Name: idx_inv_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_reference ON public.inventory_transactions USING btree (reference_type, reference_id);



--
-- Name: idx_inv_sub_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_sub_variant_id ON public.inventory_transactions USING btree (sub_variant_id);



--
-- Name: idx_inv_unit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_unit_id ON public.inventory_transactions USING btree (unit_id);



--
-- Name: idx_inv_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_variant_id ON public.inventory_transactions USING btree (variant_id);



--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status) WHERE ((status)::text = 'draft'::text);



--
-- Name: idx_merchant_sync_log_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_sync_log_started_at ON public.merchant_sync_log USING btree (started_at DESC);


--
-- Name: idx_merchant_gmc_status_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_gmc_status_status ON public.merchant_gmc_status USING btree (status);


--
-- Name: idx_merchant_gmc_status_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_gmc_status_title ON public.merchant_gmc_status USING gin (to_tsvector('simple'::regconfig, COALESCE(title, ''::text)));


--
-- Name: idx_amazon_sync_log_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_amazon_sync_log_started_at ON public.amazon_sync_log USING btree (started_at DESC);


--
-- Name: idx_amazon_listing_status_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_amazon_listing_status_status ON public.amazon_listing_status USING btree (status);


--
-- Name: idx_amazon_listing_status_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_amazon_listing_status_title ON public.amazon_listing_status USING gin (to_tsvector('simple'::regconfig, COALESCE(title, ''::text)));


--
-- Name: idx_ads_daily_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_daily_metrics_date ON public.ads_daily_metrics USING btree (date);


--
-- Name: idx_ads_product_metrics_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_product_metrics_item ON public.ads_product_metrics USING btree (item_id, date);


--
-- Name: idx_ads_product_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_product_metrics_date ON public.ads_product_metrics USING btree (date);


--
-- Name: idx_ads_search_terms_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_search_terms_date ON public.ads_search_terms USING btree (date);


--
-- Name: idx_ads_geo_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_geo_metrics_date ON public.ads_geo_metrics USING btree (date);


--
-- Name: idx_ads_ads_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_ads_approval ON public.ads_ads USING btree (approval_status);


--
-- Name: idx_ads_ad_groups_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_ad_groups_campaign ON public.ads_ad_groups USING btree (campaign_id);


--
-- Name: idx_ads_experiments_base_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_experiments_base_campaign ON public.ads_experiments USING btree (base_campaign_id);


--
-- Name: idx_ads_change_events_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_change_events_time ON public.ads_change_events USING btree (change_date_time DESC);


--
-- Name: idx_ads_change_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_change_log_created_at ON public.ads_change_log USING btree (created_at DESC);


--
-- Name: idx_ads_sync_log_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_sync_log_started_at ON public.ads_sync_log USING btree (started_at DESC);


--
-- Name: idx_ads_conversion_uploads_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_conversion_uploads_due ON public.ads_conversion_uploads USING btree (next_attempt_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_ads_conversion_uploads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_conversion_uploads_created_at ON public.ads_conversion_uploads USING btree (created_at DESC);


--
-- Name: idx_ads_conversion_uploads_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_conversion_uploads_request_id ON public.ads_conversion_uploads USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_ads_conversion_requests_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_conversion_requests_due ON public.ads_conversion_requests USING btree (next_check_at) WHERE (finished_at IS NULL);


--
-- Name: idx_ads_conversion_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_conversion_requests_created_at ON public.ads_conversion_requests USING btree (created_at DESC);

--
-- Name: idx_ads_alerts_active_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ads_alerts_active_key ON public.ads_alerts USING btree (dedupe_key) WHERE ((status)::text = ANY ((ARRAY['open'::character varying, 'dismissed'::character varying])::text[]));

--
-- Name: idx_ads_alerts_key_notified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_alerts_key_notified ON public.ads_alerts USING btree (dedupe_key, notified_at DESC);

--
-- Name: idx_ads_alerts_status_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_alerts_status_seen ON public.ads_alerts USING btree (status, last_seen_at DESC);


--
-- Name: idx_product_variants_asin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_asin ON public.product_variants USING btree (asin) WHERE (asin IS NOT NULL);



--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);



--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (is_read = false);

CREATE INDEX idx_push_devices_user_active ON public.push_devices USING btree (user_id) WHERE (disabled_at IS NULL);

CREATE INDEX idx_push_sends_user ON public.push_sends USING btree (user_id, sent_at DESC) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_push_sends_device ON public.push_sends USING btree (push_device_id, sent_at DESC) WHERE (user_id IS NULL);

CREATE INDEX idx_push_queue_due ON public.push_queue USING btree (send_after);

CREATE INDEX idx_notifications_source_ref ON public.notifications USING btree (source, source_ref) WHERE (source_ref IS NOT NULL);

CREATE INDEX idx_admin_notifications_unread ON public.admin_notifications USING btree (is_read, created_at DESC);

CREATE INDEX idx_admin_notifications_entity ON public.admin_notifications USING btree (entity_type, entity_id);



--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);



--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);



--
-- Name: idx_order_items_sub_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_sub_variant_id ON public.order_items USING btree (sub_variant_id);



--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);



--
-- Name: idx_orders_gclid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_gclid ON public.orders USING btree (gclid) WHERE (gclid IS NOT NULL);


--
-- Name: idx_orders_customer_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_email_trgm ON public.orders USING gin (customer_email public.gin_trgm_ops);



--
-- Name: idx_orders_customer_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_name_trgm ON public.orders USING gin (customer_name public.gin_trgm_ops);



--
-- Name: idx_orders_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_invoice_date ON public.orders USING btree (invoice_date) WHERE (invoice_number IS NOT NULL);



--
-- Name: idx_orders_invoice_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_invoice_number_trgm ON public.orders USING gin (invoice_number public.gin_trgm_ops);



--
-- Name: idx_orders_irn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_irn ON public.orders USING btree (irn) WHERE (irn IS NOT NULL);



--
-- Name: idx_orders_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_number ON public.orders USING btree (order_number);



--
-- Name: idx_orders_order_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_number_trgm ON public.orders USING gin (order_number public.gin_trgm_ops);



--
-- Name: idx_orders_original_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_original_order_id ON public.orders USING btree (original_order_id);



--
-- Name: idx_orders_awb_number_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_awb_number_prefix ON public.orders USING btree (awb_number text_pattern_ops) WHERE (awb_number IS NOT NULL);



--
-- Name: idx_orders_delivered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_delivered_at ON public.orders USING btree (delivered_at) WHERE (delivered_at IS NOT NULL);



--
-- Name: idx_orders_payment_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_mode ON public.orders USING btree (payment_mode);



--
-- Name: idx_orders_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_status ON public.orders USING btree (payment_status);



--
-- Name: idx_orders_shipment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shipment_status ON public.orders USING btree (shipment_status) WHERE (shipment_status IS NOT NULL);



--
-- Name: idx_orders_shipped_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shipped_at ON public.orders USING btree (shipped_at) WHERE (shipped_at IS NOT NULL);



--
-- Name: idx_orders_total_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_total_amount ON public.orders USING btree (total_amount);



--
-- Name: idx_orders_payment_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_link_id ON public.orders USING btree (payment_link_id) WHERE (payment_link_id IS NOT NULL);



--
-- Name: idx_orders_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_search_vector ON public.orders USING gin (search_vector);



--
-- Name: idx_orders_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_source ON public.orders USING btree (source);



--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);



--
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);



--
-- Name: idx_otp_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_email ON public.otp_verifications USING btree (email);



--
-- Name: idx_otp_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_expires ON public.otp_verifications USING btree (expires_at);



--
-- Name: idx_pae_log_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pae_log_product_id ON public.product_ai_enrichment_log USING btree (product_id);



--
-- Name: idx_pae_log_proposed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pae_log_proposed_at ON public.product_ai_enrichment_log USING btree (proposed_at DESC);



--
-- Name: idx_pae_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pae_log_status ON public.product_ai_enrichment_log USING btree (status);



--
-- Name: idx_page_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_created_at ON public.page_events USING btree (created_at DESC);



--
-- Name: idx_page_events_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_page ON public.page_events USING btree (page);



--
-- Name: idx_page_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_session ON public.page_events USING btree (session_id);



--
-- Name: idx_page_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_user_id ON public.page_events USING btree (user_id);



--
-- Name: idx_payments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order_id ON public.payments USING btree (order_id);



--
-- Name: idx_payments_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_transaction_id ON public.payments USING btree (transaction_id);



--
-- Name: idx_po_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_number_trgm ON public.purchase_orders USING gin (po_number public.gin_trgm_ops);



--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.purchase_orders USING btree (status);



--
-- Name: idx_po_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supplier ON public.purchase_orders USING btree (supplier_id);



--
-- Name: idx_price_inflation_log_applied_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_inflation_log_applied_at ON public.price_inflation_log USING btree (applied_at DESC);



--
-- Name: idx_price_inflation_log_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_inflation_log_category ON public.price_inflation_log USING btree (category_id);



--
-- Name: idx_product_images_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_product_id ON public.product_images USING btree (product_id);



--
-- Name: idx_product_sub_variants_inventory_quantity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sub_variants_inventory_quantity ON public.product_sub_variants USING btree (inventory_quantity);



--
-- Name: idx_product_unit_rules_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_unit_rules_unit ON public.product_unit_rules USING btree (product_unit_id) WHERE (is_active = true);



--
-- Name: idx_product_units_base; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_units_base ON public.product_units USING btree (variant_id) WHERE (is_base = true);



--
-- Name: idx_product_units_dimension; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_units_dimension ON public.product_units USING btree (dimension);



--
-- Name: idx_product_units_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_units_product ON public.product_units USING btree (product_id);



--
-- Name: idx_product_units_sub_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_units_sub_variant_id ON public.product_units USING btree (sub_variant_id) WHERE (sub_variant_id IS NOT NULL);



--
-- Name: idx_product_units_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_units_variant ON public.product_units USING btree (variant_id);



--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id);



--
-- Name: idx_product_views_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_created_at ON public.product_views USING btree (created_at);



--
-- Name: idx_product_views_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_product_id ON public.product_views USING btree (product_id);



--
-- Name: idx_products_ai_keywords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_ai_keywords ON public.products USING gin (ai_keywords);



--
-- Name: idx_products_ai_search_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_ai_search_tags ON public.products USING gin (ai_search_tags);



--
-- Name: idx_products_ai_use_cases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_ai_use_cases ON public.products USING gin (ai_use_cases);



--
-- Name: idx_products_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand_id ON public.products USING btree (brand_id);



--
-- Name: idx_products_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);



--
-- Name: idx_products_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_active ON public.products USING btree (is_active);



--
-- Name: idx_products_is_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_featured ON public.products USING btree (is_featured);



--
-- Name: idx_products_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_trgm ON public.products USING gin (name public.gin_trgm_ops);



--
-- Name: idx_products_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_search_vector ON public.products USING gin (search_vector);



--
-- Name: idx_products_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku ON public.products USING btree (sku);



--
-- Name: idx_products_sku_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_trgm ON public.products USING gin (sku public.gin_trgm_ops);



--
-- Name: idx_products_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_slug ON public.products USING btree (slug);



--
-- Name: idx_quotation_items_quotation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotation_items_quotation_id ON public.quotation_items USING btree (quotation_id);



--
-- Name: idx_quotations_consignee_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_consignee_name_trgm ON public.quotations USING gin (consignee_name public.gin_trgm_ops);



--
-- Name: idx_quotations_quote_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_quote_date ON public.quotations USING btree (quote_date);



--
-- Name: idx_quotations_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_search_vector ON public.quotations USING gin (search_vector);



--
-- Name: idx_quotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_status ON public.quotations USING btree (status);





--
-- Name: idx_return_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_order_id ON public.return_requests USING btree (order_id);



--
-- Name: idx_return_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_status ON public.return_requests USING btree (status);



--
-- Name: idx_return_requests_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_type_created ON public.return_requests USING btree (type, created_at DESC);



--
-- Name: idx_return_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_user_id ON public.return_requests USING btree (user_id);



--
-- Name: idx_order_adjustments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_adjustments_order_id ON public.order_adjustments USING btree (order_id);

--
-- Name: idx_order_adjustments_rzp_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_order_adjustments_rzp_order ON public.order_adjustments USING btree (razorpay_order_id) WHERE (razorpay_order_id IS NOT NULL);

--
-- Name: idx_order_adjustments_one_open; Type: INDEX; Schema: public; Owner: -
-- At most one open (pending / awaiting payment) adjustment per order.
--

CREATE UNIQUE INDEX idx_order_adjustments_one_open ON public.order_adjustments USING btree (order_id) WHERE ((status)::text = ANY (ARRAY['pending_customer'::text, 'awaiting_payment'::text]));

--
-- Name: idx_order_adjustment_lines_adjustment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_adjustment_lines_adjustment ON public.order_adjustment_lines USING btree (adjustment_id);

--
-- Name: idx_variant_change_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_change_requests_order_id ON public.variant_change_requests USING btree (order_id);

--
-- Name: idx_variant_change_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_change_requests_status ON public.variant_change_requests USING btree (status);

--
-- Name: idx_variant_change_requests_rzp_order; Type: INDEX; Schema: public; Owner: -
-- Partial-unique on the Razorpay order id — the idempotency anchor for the
-- collect (top-up) path so a payment can only settle one change request.
--

CREATE UNIQUE INDEX idx_variant_change_requests_rzp_order ON public.variant_change_requests USING btree (razorpay_order_id) WHERE (razorpay_order_id IS NOT NULL);

--
-- Name: idx_address_change_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_change_requests_order_id ON public.address_change_requests USING btree (order_id);

--
-- Name: uq_address_change_requests_one_pending; Type: INDEX; Schema: public; Owner: -
-- At most one pending request per order; the insert relies on this to reject a duplicate.
--

CREATE UNIQUE INDEX uq_address_change_requests_one_pending ON public.address_change_requests USING btree (order_id) WHERE ((status)::text = 'pending'::text);




--
-- Name: idx_reviews_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_product_id ON public.product_reviews USING btree (product_id);



--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.product_reviews USING btree (user_id);



--
-- Name: idx_rfq_messages_rfq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_messages_rfq_id ON public.rfq_messages USING btree (rfq_id);



--
-- Name: idx_scenario_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenario_audit_admin ON public.scenario_audit_log USING btree (admin_id, created_at DESC);



--
-- Name: idx_scenario_audit_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenario_audit_kind ON public.scenario_audit_log USING btree (scenario_kind, created_at DESC);



--
-- Name: idx_search_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_created ON public.search_logs USING btree (created_at DESC);



--
-- Name: idx_search_logs_no_results; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_no_results ON public.search_logs USING btree (query) WHERE (results_count = 0);



--
-- Name: idx_search_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_user ON public.search_logs USING btree (user_id);



--
-- Name: idx_search_queries_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_queries_created_at ON public.search_queries USING btree (created_at);



--
-- Name: idx_service_accounts_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_accounts_created_by ON public.service_accounts USING btree (created_by);



--
-- Name: idx_service_accounts_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_accounts_revoked ON public.service_accounts USING btree (is_revoked);



--
-- Name: idx_service_accounts_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_accounts_serial ON public.service_accounts USING btree (serial_number);



--
-- Name: idx_sub_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_variants_product_id ON public.product_sub_variants USING btree (product_id);



--
-- Name: idx_sub_variants_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_variants_variant_id ON public.product_sub_variants USING btree (variant_id);



--
-- Name: idx_suppliers_contact_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_contact_name_trgm ON public.suppliers USING gin (contact_name public.gin_trgm_ops);



--
-- Name: idx_suppliers_gstin_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_gstin_trgm ON public.suppliers USING gin (gstin public.gin_trgm_ops);



--
-- Name: idx_suppliers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_name_trgm ON public.suppliers USING gin (name public.gin_trgm_ops);



--
-- Name: idx_support_messages_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_session_id ON public.support_messages USING btree (session_id);



--
-- Name: idx_support_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_sessions_status ON public.support_sessions USING btree (status);



--
-- Name: idx_support_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_sessions_user_id ON public.support_sessions USING btree (user_id);


--
-- Name: idx_support_sessions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_sessions_tenant_id ON public.support_sessions USING btree (tenant_id);



--
-- Name: idx_unique_primary_image_per_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_primary_image_per_product ON public.product_images USING btree (product_id) WHERE (is_primary = true);



--
-- Name: idx_unique_primary_image_per_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_primary_image_per_variant ON public.variant_images USING btree (variant_id) WHERE (is_primary = true);



--
-- Name: idx_user_search_history_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_search_history_user_created ON public.user_search_history USING btree (user_id, created_at DESC);



--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);



--
-- Name: idx_users_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_trgm ON public.users USING gin (email public.gin_trgm_ops);



--
-- Name: idx_users_google_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_google_id ON public.users USING btree (google_id);



--
-- Name: idx_users_is_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_guest ON public.users USING btree (is_guest);



--
-- Name: idx_users_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_trgm ON public.users USING gin (phone public.gin_trgm_ops);



--
-- Name: idx_users_phone_verified_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_phone_verified_unique ON public.users USING btree (phone, user_type) WHERE (phone_verified = true AND phone IS NOT NULL);



--
-- Name: idx_users_policies_accepted_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_policies_accepted_version ON public.users USING btree (policies_accepted_version);



--
-- Name: idx_users_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_session_id ON public.users USING btree (session_id);



--
-- Name: idx_users_unsubscribe_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_unsubscribe_token ON public.users USING btree (unsubscribe_token);



--
-- Name: idx_variant_images_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_images_variant_id ON public.variant_images USING btree (variant_id);



--
-- Name: idx_variants_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_name_trgm ON public.product_variants USING gin (variant_name public.gin_trgm_ops);



--
-- Name: idx_variants_sku_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_sku_trgm ON public.product_variants USING gin (sku public.gin_trgm_ops);



--
-- Name: idx_wishlist_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wishlist_user_id ON public.wishlist_items USING btree (user_id);



--
-- Name: idx_ws_connections_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_connections_session_id ON public.websocket_connections USING btree (session_id);



--
-- Name: orders_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_view_token_idx ON public.orders USING btree (view_token);



--
-- Name: purchase_orders_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_orders_view_token_idx ON public.purchase_orders USING btree (view_token);



--
-- Name: quotations_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_view_token_idx ON public.quotations USING btree (view_token);



--
-- Name: review_form_submissions_email_form; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_form_submissions_email_form ON public.review_form_submissions USING btree (form_id, email);



--
-- Name: shelf_locations_warehouse_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shelf_locations_warehouse_idx ON public.shelf_locations USING btree (warehouse_id);



--
-- Name: shelf_stock_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shelf_stock_location_idx ON public.shelf_stock USING btree (location_id);



--
-- Name: shelf_stock_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shelf_stock_product_idx ON public.shelf_stock USING btree (product_id);



--
-- Name: shelf_stock_unique; Type: INDEX; Schema: public; Owner: -
-- One shelf_stock row per (location, product, variant, sub_variant).
--

CREATE UNIQUE INDEX IF NOT EXISTS shelf_stock_unique ON public.shelf_stock USING btree (location_id, product_id, variant_id, sub_variant_id);



--
-- Name: shelf_stock_uniq_var_no_subvar; Type: INDEX; Schema: public; Owner: -
-- PG14 treats NULLs as DISTINCT, so shelf_stock_unique does NOT prevent
-- duplicates when sub_variant_id IS NULL. These partial unique indexes cover
-- the NULL patterns (variant present / product-level) so a location can never
-- hold two stock rows for the same product/variant.
--

CREATE UNIQUE INDEX IF NOT EXISTS shelf_stock_uniq_var_no_subvar ON public.shelf_stock USING btree (location_id, product_id, variant_id) WHERE sub_variant_id IS NULL AND variant_id IS NOT NULL;



--
-- Name: shelf_stock_uniq_product_only; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS shelf_stock_uniq_product_only ON public.shelf_stock USING btree (location_id, product_id) WHERE variant_id IS NULL AND sub_variant_id IS NULL;



--
-- Name: uniq_product_units_one_base_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_base_product ON public.product_units USING btree (product_id) WHERE ((is_base = true) AND (variant_id IS NULL) AND (sub_variant_id IS NULL));



--
-- Name: uniq_product_units_one_base_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_base_variant ON public.product_units USING btree (variant_id) WHERE ((is_base = true) AND (variant_id IS NOT NULL) AND (sub_variant_id IS NULL));



--
-- Name: uniq_product_units_one_purchase_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_purchase_product ON public.product_units USING btree (product_id) WHERE ((is_purchase_default = true) AND (variant_id IS NULL) AND (sub_variant_id IS NULL));



--
-- Name: uniq_product_units_one_purchase_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_purchase_variant ON public.product_units USING btree (variant_id) WHERE ((is_purchase_default = true) AND (variant_id IS NOT NULL) AND (sub_variant_id IS NULL));



--
-- Name: uniq_product_units_product_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_product_unit ON public.product_units USING btree (product_id, unit) WHERE (variant_id IS NULL);



--
-- Name: uniq_product_units_one_base_sub_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_base_sub_variant ON public.product_units USING btree (sub_variant_id) WHERE ((is_base = true) AND (sub_variant_id IS NOT NULL));


--
-- Name: uniq_product_units_one_purchase_sub_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_purchase_sub_variant ON public.product_units USING btree (sub_variant_id) WHERE ((is_purchase_default = true) AND (sub_variant_id IS NOT NULL));


--
-- Name: uniq_product_units_sub_variant_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_sub_variant_unit ON public.product_units USING btree (sub_variant_id, unit) WHERE (sub_variant_id IS NOT NULL);



--
-- Name: uniq_product_units_variant_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_variant_unit ON public.product_units USING btree (variant_id, unit) WHERE (variant_id IS NOT NULL);


--
-- Name: product_suppliers indexes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_suppliers_product ON public.product_suppliers USING btree (product_id);

CREATE INDEX idx_product_suppliers_supplier ON public.product_suppliers USING btree (supplier_id);

CREATE INDEX idx_product_suppliers_variant ON public.product_suppliers USING btree (variant_id) WHERE (variant_id IS NOT NULL);

CREATE INDEX idx_product_suppliers_sub_variant ON public.product_suppliers USING btree (sub_variant_id) WHERE (sub_variant_id IS NOT NULL);

CREATE INDEX idx_product_suppliers_leaf_eff ON public.product_suppliers USING btree (product_id, variant_id, sub_variant_id, supplier_id, effective_date DESC);

-- At most one preferred supplier per LEAF (product/variant/sub-variant). NULLs coalesced so
-- the nil-uuid stands in for "no variant/sub-variant" and participates in the unique key.
CREATE UNIQUE INDEX uq_product_suppliers_one_preferred
    ON public.product_suppliers (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(sub_variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE (is_preferred = true);


--
-- Name: purchase_order_items sub_variant index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_sub_variant ON public.purchase_order_items USING btree (sub_variant_id) WHERE (sub_variant_id IS NOT NULL);


--
-- Name: auth_sessions indexes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_principal ON public.auth_sessions USING btree (principal_type, principal_id) WHERE (revoked_at IS NULL);

CREATE INDEX idx_auth_sessions_expiry ON public.auth_sessions USING btree (expires_at);

-- Cookie-resolution key: the cookie carries a random opaque token; the DB stores only
-- SHA-256(token) here and resolveSession() looks it up by hash. Unique so a hash maps to at
-- most one session; NULL on legacy (pre-token) rows, which Postgres allows multiple of.
CREATE UNIQUE INDEX idx_auth_sessions_token_hash ON public.auth_sessions USING btree (token_hash);


-- hero_slides: active slides ordered for the homepage carousel
CREATE INDEX idx_hero_slides_active_order ON public.hero_slides USING btree (is_active, display_order) WHERE (is_active = true);

-- product_offers: active offers ordered for the homepage slider
CREATE INDEX idx_product_offers_active_order ON public.product_offers USING btree (is_active, display_order) WHERE (is_active = true);
-- product_offer_items: membership lookups both directions
CREATE INDEX idx_product_offer_items_product ON public.product_offer_items USING btree (product_id);


--
-- Name: idx_homepage_sections_active_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_homepage_sections_active_order ON public.homepage_sections USING btree (is_active, display_order) WHERE (is_active = true);

-- Barcode / serial scanning: fast lookup by scannable identifiers
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products USING btree (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_gtin ON public.products USING btree (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_gtin ON public.product_variants USING btree (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_serials_serial ON public.product_serials USING btree (serial_number);
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON public.product_serials USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_status ON public.product_serials USING btree (status);
CREATE INDEX IF NOT EXISTS idx_product_serials_order ON public.product_serials USING btree (order_id) WHERE order_id IS NOT NULL;
-- One in-stock serial per (product, serial_number): prevents duplicate in-stock units
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_serials_instock ON public.product_serials USING btree (product_id, serial_number) WHERE status = 'in_stock';
-- Serial numbers must be globally unique among in-stock units (no two in-stock
-- serials may share a number, even across different products).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_serials_instock_global ON public.product_serials USING btree (serial_number) WHERE status = 'in_stock';


--
-- Name: idx_offer_display_settings_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_display_settings_visible ON public.offer_display_settings USING btree (is_visible, display_order);


--
-- Name: idx_loyalty_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_ledger_user ON public.loyalty_ledger USING btree (user_id, created_at DESC);


--
-- Name: idx_loyalty_ledger_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_ledger_order ON public.loyalty_ledger USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_loyalty_ledger_coupon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_ledger_coupon ON public.loyalty_ledger USING btree (coupon_id) WHERE (coupon_id IS NOT NULL);


--
-- Name: idx_loyalty_accounts_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_accounts_tier ON public.loyalty_accounts USING btree (tier, tier_updated_at DESC);


--
-- Name: idx_referrals_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referrer ON public.referrals USING btree (referrer_user_id, status);


--
-- Name: idx_referral_signups_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_signups_referrer ON public.referral_signups USING btree (referrer_user_id, status);


--
-- Name: idx_subscriptions_renewal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_renewal ON public.subscriptions USING btree (status, next_renewal_at);


--
-- Name: idx_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id, status);


--
-- Digital products, vault & customer subscriptions
--

CREATE INDEX idx_product_files_product ON public.product_files USING btree (product_id, display_order);

CREATE INDEX idx_vault_entitlements_user ON public.vault_entitlements USING btree (user_id, status);
CREATE INDEX idx_vault_entitlements_product ON public.vault_entitlements USING btree (product_id);
CREATE INDEX idx_vault_entitlements_order ON public.vault_entitlements USING btree (order_id);
CREATE INDEX idx_vault_entitlements_subscription ON public.vault_entitlements USING btree (subscription_id);

CREATE INDEX idx_subscription_cycle_orders_sub ON public.subscription_cycle_orders USING btree (subscription_id, cycle_number);

-- Only the legacy crons-era stubs feed the subscription_renewal campaign now.
CREATE INDEX idx_subscriptions_rzp ON public.subscriptions USING btree (razorpay_subscription_id);
CREATE INDEX idx_subscriptions_legacy_renewal ON public.subscriptions USING btree (status, next_renewal_at) WHERE razorpay_subscription_id IS NULL;

CREATE INDEX idx_orders_subscription ON public.orders USING btree (subscription_id) WHERE subscription_id IS NOT NULL;

CREATE INDEX idx_vault_tickets_expires ON public.vault_tickets USING btree (expires_at);

CREATE INDEX idx_vault_access_log_user ON public.vault_access_log USING btree (user_id, created_at);
CREATE INDEX idx_upload_sessions_product ON public.upload_sessions USING btree (product_id, status);

-- One live session per admin + resource. closed_at IS NULL rows cover the "open" state;
-- closed sessions are historical and can repeat without conflict.
CREATE UNIQUE INDEX idx_editor_sessions_open
  ON public.editor_sessions (admin_id, resource_type, resource_id)
  WHERE closed_at IS NULL;

CREATE INDEX idx_editor_sessions_resource
  ON public.editor_sessions (resource_type, resource_id, started_at DESC);

-- One open po_drafts row per admin — once promoted_po_id is set, the draft is
-- "spent" and a new draft can be opened.
CREATE UNIQUE INDEX idx_po_drafts_open
  ON public.po_drafts (admin_id)
  WHERE promoted_po_id IS NULL;

CREATE INDEX idx_po_drafts_admin ON public.po_drafts (admin_id, updated_at DESC);
CREATE INDEX idx_po_receive_drafts_admin ON public.po_receive_drafts (admin_id, updated_at DESC);
CREATE INDEX idx_offer_drafts_updated ON public.offer_drafts (updated_at DESC);

CREATE UNIQUE INDEX idx_campaign_drafts_kind ON public.campaign_drafts (kind);
CREATE INDEX idx_campaign_drafts_updated ON public.campaign_drafts (updated_at DESC);

-- Messaging templates library (per-tenant). See database/messaging.sql.
CREATE INDEX IF NOT EXISTS idx_family_tenant_cat ON public.template_family (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_template_tenant_channel ON public.template (tenant_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_variant_template ON public.template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_variant_approval ON public.template_variant (tenant_id, approval_status) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_version_variant ON public.template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_asset_tenant_kind ON public.template_asset (tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_short_link_tenant ON public.short_link (tenant_id, created_at DESC);

-- Platform catalog + public-API customer copies. See database/messaging.sql.
CREATE INDEX IF NOT EXISTS idx_platform_family_cat ON public.platform_template_family (category);
CREATE INDEX IF NOT EXISTS idx_platform_template_channel ON public.platform_template (channel, status);
CREATE INDEX IF NOT EXISTS idx_platform_version_variant ON public.platform_template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pub_family_user_cat ON public.pub_template_family (public_user_id, category);
CREATE INDEX IF NOT EXISTS idx_pub_template_user_channel ON public.pub_template (public_user_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_pub_variant_template ON public.pub_template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_pub_version_variant ON public.pub_template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pub_asset_user_kind ON public.pub_template_asset (public_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_pub_short_link_user ON public.pub_short_link (public_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_campaign_logs_campaign_channel ON public.email_campaign_logs (campaign_id, channel);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_created ON public.documents (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON public.messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_provider_ref ON public.messages (provider_ref);
CREATE INDEX IF NOT EXISTS idx_messages_batch ON public.messages (batch_id);
CREATE INDEX IF NOT EXISTS idx_message_events_message ON public.message_events (message_id);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_tenant_kind ON public.bulk_jobs (tenant_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_items_claim ON public.bulk_job_items (status, job_id, seq);
CREATE INDEX IF NOT EXISTS idx_bulk_items_job ON public.bulk_job_items (job_id, seq);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON public.platform_invoices (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_service_approvals_pending ON public.tenant_service_approvals (status, requested_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_channel_sync_log_channel ON public.channel_sync_log (channel, kind, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_alerts_active_key ON public.channel_alerts (channel, dedupe_key) WHERE ((status)::text = ANY ((ARRAY['open'::character varying, 'dismissed'::character varying])::text[]));

CREATE INDEX IF NOT EXISTS idx_channel_alerts_key_notified ON public.channel_alerts (channel, dedupe_key, notified_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_alerts_status_seen ON public.channel_alerts (channel, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_change_log_channel ON public.channel_change_log (channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gmc_product_performance_offer ON public.gmc_product_performance (offer_id, date);

CREATE INDEX IF NOT EXISTS idx_gmc_best_sellers_status ON public.gmc_best_sellers (report_date, catalog_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_repricer_rules_sku ON public.amazon_repricer_rules (COALESCE(sku, ''));

CREATE INDEX IF NOT EXISTS idx_amazon_orders_updated ON public.amazon_orders (last_update_date DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_order_items_order ON public.amazon_order_items (amazon_order_id);

CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku ON public.amazon_order_items (sku);

CREATE INDEX IF NOT EXISTS idx_aads_search_terms_term ON public.aads_search_terms (search_term, date);

CREATE INDEX IF NOT EXISTS idx_aads_keywords_ad_group ON public.aads_keywords (ad_group_id);

CREATE INDEX IF NOT EXISTS idx_mads_daily_metrics_campaign ON public.mads_daily_metrics (campaign_id, date);

CREATE INDEX IF NOT EXISTS idx_mads_capi_events_status ON public.mads_capi_events (status, created_at DESC);

CREATE INDEX idx_cart_items_created_at ON public.cart_items USING btree (created_at);
CREATE INDEX idx_pending_payment_intents_created_at ON public.pending_payment_intents USING btree (created_at);
CREATE INDEX idx_product_views_user_created ON public.product_views USING btree (user_id, created_at);
CREATE INDEX idx_wishlist_items_product_id ON public.wishlist_items USING btree (product_id);

CREATE INDEX IF NOT EXISTS idx_gallery_videos_tenant_created ON public.gallery_videos USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_videos_tenant_source ON public.gallery_videos USING btree (tenant_id, source);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gallery_videos_bucket_key ON public.gallery_videos USING btree (s3_bucket, s3_key);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_presets_tenant_kind_feature_order ON public.ai_prompt_presets USING btree (tenant_id, kind, feature, display_order);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_presets_kind_feature ON public.ai_prompt_presets USING btree (kind, feature);
-- Nullable tenant_id/feature mean a plain UNIQUE would allow dupes; COALESCE collapses NULL so the
-- (tenant, kind, feature, scenario) key is enforced even for platform rows and the "any-feature" slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_prompt_presets_scope_scenario ON public.ai_prompt_presets USING btree (
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    COALESCE(feature, ''::text),
    scenario
);
