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
-- Name: idx_coupons_generated_for; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_generated_for ON public.coupons USING btree (generated_for_user_id, generated_for_campaign) WHERE (auto_generated = true);



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
-- Name: idx_email_campaign_logs_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaign_logs_campaign ON public.email_campaign_logs USING btree (campaign_id);



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
-- Name: idx_email_logs_status_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_status_sent_at ON public.email_logs USING btree (status, sent_at DESC);



--
-- Name: idx_email_sent_campaign_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sent_campaign_user ON public.email_campaigns_sent USING btree (campaign_kind, user_id, sent_at DESC);



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
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);



--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);



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
-- Name: idx_orders_customer_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_email_trgm ON public.orders USING gin (customer_email public.gin_trgm_ops);



--
-- Name: idx_orders_customer_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_name_trgm ON public.orders USING gin (customer_name public.gin_trgm_ops);



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
-- Name: idx_replication_runs_recorded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replication_runs_recorded_at ON public.replication_runs USING btree (recorded_at DESC);



--
-- Name: idx_replication_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replication_runs_status ON public.replication_runs USING btree (status);



--
-- Name: idx_return_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_order_id ON public.return_requests USING btree (order_id);



--
-- Name: idx_return_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_status ON public.return_requests USING btree (status);



--
-- Name: idx_return_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_user_id ON public.return_requests USING btree (user_id);



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

CREATE UNIQUE INDEX uniq_product_units_one_base_product ON public.product_units USING btree (product_id) WHERE ((is_base = true) AND (variant_id IS NULL));



--
-- Name: uniq_product_units_one_base_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_base_variant ON public.product_units USING btree (variant_id) WHERE ((is_base = true) AND (variant_id IS NOT NULL));



--
-- Name: uniq_product_units_one_purchase_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_purchase_product ON public.product_units USING btree (product_id) WHERE ((is_purchase_default = true) AND (variant_id IS NULL));



--
-- Name: uniq_product_units_one_purchase_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_one_purchase_variant ON public.product_units USING btree (variant_id) WHERE ((is_purchase_default = true) AND (variant_id IS NOT NULL));



--
-- Name: uniq_product_units_product_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_product_unit ON public.product_units USING btree (product_id, unit) WHERE (variant_id IS NULL);



--
-- Name: uniq_product_units_sub_variant_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_sub_variant_unit ON public.product_units USING btree (sub_variant_id, unit) WHERE (sub_variant_id IS NOT NULL);



--
-- Name: uniq_product_units_variant_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_product_units_variant_unit ON public.product_units USING btree (variant_id, unit) WHERE (variant_id IS NOT NULL);

