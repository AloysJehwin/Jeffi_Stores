-- document-service: indexes. Load order comes from scripts/db-files.mjs.

--
-- Name: idx_cash_sale_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_product_id ON public.cash_sale_items USING btree (product_id);



--
-- Name: idx_cash_sale_items_sale_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_sale_id ON public.cash_sale_items USING btree (sale_id);



--
-- Name: idx_cash_sale_drafts_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_drafts_admin ON public.cash_sale_drafts USING btree (admin_id, updated_at DESC);


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

CREATE INDEX idx_drive_folders_parent ON public.drive_folders USING btree (parent_id) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX idx_drive_folders_system_key ON public.drive_folders USING btree (system_key) WHERE (system_key IS NOT NULL);

CREATE INDEX idx_drive_files_folder ON public.drive_files USING btree (folder_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_drive_files_deleted ON public.drive_files USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX idx_drive_files_name_trgm ON public.drive_files USING gin (name public.gin_trgm_ops);

CREATE INDEX idx_drive_shares_folder ON public.drive_shares USING btree (folder_id) WHERE (folder_id IS NOT NULL);

CREATE INDEX idx_drive_shares_file ON public.drive_shares USING btree (file_id) WHERE (file_id IS NOT NULL);

CREATE INDEX idx_drive_shares_grantee ON public.drive_shares USING btree (grantee_admin_id) WHERE (grantee_admin_id IS NOT NULL);

CREATE INDEX idx_drive_access_log_file ON public.drive_access_log USING btree (file_id, created_at DESC);



--
-- Name: purchase_orders_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_orders_view_token_idx ON public.purchase_orders USING btree (view_token);



--
-- Name: quotations_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_view_token_idx ON public.quotations USING btree (view_token);



--
-- Name: shelf_locations_warehouse_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shelf_locations_warehouse_idx ON public.shelf_locations USING btree (warehouse_id);


--
-- Name: purchase_order_items sub_variant index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_sub_variant ON public.purchase_order_items USING btree (sub_variant_id) WHERE (sub_variant_id IS NOT NULL);

-- One open po_drafts row per admin — once promoted_po_id is set, the draft is
-- "spent" and a new draft can be opened.
CREATE UNIQUE INDEX idx_po_drafts_open
  ON public.po_drafts (admin_id)
  WHERE promoted_po_id IS NULL;

CREATE INDEX idx_po_drafts_admin ON public.po_drafts (admin_id, updated_at DESC);
CREATE INDEX idx_po_receive_drafts_admin ON public.po_receive_drafts (admin_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_created ON public.documents (tenant_id, created_at DESC);
