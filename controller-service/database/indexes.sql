-- controller-service: indexes. Load order comes from scripts/db-files.mjs.

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
-- Name: uq_delhivery_pickup_locations_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_delhivery_pickup_locations_tenant_name ON public.delhivery_pickup_locations USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), name);


--
-- Name: idx_delhivery_pickup_locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delhivery_pickup_locations_tenant ON public.delhivery_pickup_locations USING btree (tenant_id);
