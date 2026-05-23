-- Module: 14_indexes
--
-- Name: idx_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_user_id ON public.addresses USING btree (user_id);


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
-- Name: idx_customer_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_profiles_user_id ON public.customer_profiles USING btree (user_id);


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
-- Name: idx_inv_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_variant_id ON public.inventory_transactions USING btree (variant_id);


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
-- Name: idx_search_queries_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_queries_created_at ON public.search_queries USING btree (created_at);


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
-- Name: idx_users_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_session_id ON public.users USING btree (session_id);


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


