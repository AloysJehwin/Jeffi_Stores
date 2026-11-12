-- business-service: indexes. Load order comes from scripts/db-files.mjs.

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
-- Name: idx_rfq_messages_rfq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_messages_rfq_id ON public.rfq_messages USING btree (rfq_id);
