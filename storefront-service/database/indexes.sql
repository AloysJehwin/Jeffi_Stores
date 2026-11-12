-- storefront-service: indexes. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: cart_items_upsert_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cart_items_upsert_key ON public.cart_items USING btree (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(sub_variant_id, '00000000-0000-0000-0000-000000000000'::uuid), buy_mode);



--
-- Name: idx_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_user_id ON public.addresses USING btree (user_id);



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
-- Name: idx_cart_items_user_saved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_items_user_saved ON public.cart_items USING btree (user_id, saved_for_later);



--
-- Name: idx_cart_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_user_id ON public.cart_items USING btree (user_id);



--
-- Name: idx_coupon_usage_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_order_id ON public.coupon_usage USING btree (order_id);



--
-- Name: reward_game_plays_game_user_period_key; Type: INDEX; Schema: public; Owner: -
-- The play limit: one row per user per game per period, enforced by ON CONFLICT DO NOTHING.
--

CREATE UNIQUE INDEX reward_game_plays_game_user_period_key ON public.reward_game_plays USING btree (game_key, user_id, period_key);



--
-- Name: idx_customer_activity_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activity_kind ON public.customer_activity_log USING btree (kind, created_at DESC);



--
-- Name: idx_customer_activity_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activity_user_created ON public.customer_activity_log USING btree (user_id, created_at DESC);



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
-- Name: idx_product_views_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_created_at ON public.product_views USING btree (created_at);



--
-- Name: idx_product_views_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_product_id ON public.product_views USING btree (product_id);





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
-- Name: idx_order_adjustment_lines_adjustment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_adjustment_lines_adjustment ON public.order_adjustment_lines USING btree (adjustment_id);

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
-- Name: idx_wishlist_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wishlist_user_id ON public.wishlist_items USING btree (user_id);



--
-- Name: review_form_submissions_email_form; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_form_submissions_email_form ON public.review_form_submissions USING btree (form_id, email);


--
-- Name: idx_subscriptions_renewal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_renewal ON public.subscriptions USING btree (status, next_renewal_at);


--
-- Name: idx_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id, status);

CREATE INDEX idx_vault_entitlements_user ON public.vault_entitlements USING btree (user_id, status);
CREATE INDEX idx_vault_entitlements_product ON public.vault_entitlements USING btree (product_id);
CREATE INDEX idx_vault_entitlements_order ON public.vault_entitlements USING btree (order_id);
CREATE INDEX idx_vault_entitlements_subscription ON public.vault_entitlements USING btree (subscription_id);

CREATE INDEX idx_subscription_cycle_orders_sub ON public.subscription_cycle_orders USING btree (subscription_id, cycle_number);

-- Only the legacy crons-era stubs feed the subscription_renewal campaign now.
CREATE INDEX idx_subscriptions_rzp ON public.subscriptions USING btree (razorpay_subscription_id);
CREATE INDEX idx_subscriptions_legacy_renewal ON public.subscriptions USING btree (status, next_renewal_at) WHERE razorpay_subscription_id IS NULL;

-- PhonePe Autopay: the renewal cron's scan, and at most one open redemption per subscription.
CREATE INDEX idx_subscriptions_phonepe_due ON public.subscriptions USING btree (status, current_end) WHERE ((billing_provider)::text = 'phonepe'::text);
CREATE INDEX idx_subscription_redemptions_sub ON public.subscription_redemptions USING btree (subscription_id, cycle_number);
CREATE UNIQUE INDEX uq_subscription_redemptions_open ON public.subscription_redemptions USING btree (subscription_id) WHERE ((status)::text = ANY (ARRAY['notifying'::text, 'notified'::text, 'executing'::text]));
CREATE INDEX idx_subscription_redemptions_status ON public.subscription_redemptions USING btree (status, execute_after);

CREATE INDEX idx_vault_tickets_expires ON public.vault_tickets USING btree (expires_at);

CREATE INDEX idx_user_oauth_identities_user ON public.user_oauth_identities USING btree (user_id);

CREATE INDEX idx_vault_access_log_user ON public.vault_access_log USING btree (user_id, created_at);

CREATE INDEX idx_cart_items_created_at ON public.cart_items USING btree (created_at);
CREATE INDEX idx_pending_payment_intents_created_at ON public.pending_payment_intents USING btree (created_at);
CREATE INDEX idx_product_views_user_created ON public.product_views USING btree (user_id, created_at);
CREATE INDEX idx_wishlist_items_product_id ON public.wishlist_items USING btree (product_id);
