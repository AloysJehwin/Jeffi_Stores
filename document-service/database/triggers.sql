-- document-service: triggers. Load order comes from scripts/db-files.mjs.

--
-- Name: quotations quotations_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quotations_search_vector_trig BEFORE INSERT OR UPDATE OF quote_number, consignee_name, consignee_gstin, buyer_name ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_search_vector_update();



--
-- Name: cash_sale_items trg_audit_cash_sale_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_cash_sale_items AFTER INSERT OR DELETE OR UPDATE ON public.cash_sale_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('product_id,variant_id,sub_variant_id,product_name,variant_name,quantity,unit_price,discount_amount,total_price,buy_unit', 'sale_id');



--
-- Name: cash_sales trg_audit_cash_sales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_cash_sales AFTER INSERT OR DELETE OR UPDATE ON public.cash_sales FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,customer_name,customer_phone,payment_mode,payment_status,subtotal,tax_amount,total_amount,notes,invoice_number', '');



--
-- Name: grn_items trg_audit_grn_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_grn_items AFTER INSERT OR DELETE OR UPDATE ON public.grn_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'grn_id');



--
-- Name: grns trg_audit_grns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_grns AFTER INSERT OR DELETE OR UPDATE ON public.grns FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: invoices trg_audit_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invoice_number,status,pdf_url', 'order_id|sale_id');



--
-- Name: purchase_order_items trg_audit_purchase_order_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_order_items AFTER INSERT OR DELETE OR UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'po_id');



--
-- Name: purchase_orders trg_audit_purchase_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_orders AFTER INSERT OR DELETE OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: quotation_items trg_audit_quotation_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_quotation_items AFTER INSERT OR DELETE OR UPDATE ON public.quotation_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('description,product_id,variant_id,sub_variant_id,quantity,unit,rate,discount_pct,gst_rate,hsn_code,amount', 'quotation_id');



--
-- Name: quotations trg_audit_quotations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_quotations AFTER INSERT OR DELETE OR UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,quote_date,consignee_name,consignee_gstin,consignee_phone,consignee_email,consignee_addr1,consignee_addr2,consignee_city,consignee_state,consignee_pincode,buyer_name,buyer_gstin,buyer_phone,buyer_email,buyer_addr1,buyer_addr2,buyer_city,buyer_state,buyer_pincode,notes,subtotal,cgst_amount,sgst_amount,total_amount,converted_order_id', '');



--
-- Name: shelf_locations trg_audit_shelf_locations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shelf_locations AFTER INSERT OR DELETE OR UPDATE ON public.shelf_locations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: warehouses trg_audit_warehouses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_warehouses AFTER INSERT OR DELETE OR UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: cash_sales trig_cash_sales_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_cash_sales_search_vector BEFORE INSERT OR UPDATE ON public.cash_sales FOR EACH ROW EXECUTE FUNCTION public.cash_sales_search_vector_update();
