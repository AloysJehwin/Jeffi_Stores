-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: product_images check_product_image_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_product_image_limit BEFORE INSERT ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.validate_product_image_limit();



--
-- Name: product_views increment_product_views_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER increment_product_views_trigger AFTER INSERT ON public.product_views FOR EACH ROW EXECUTE FUNCTION public.increment_product_views();



--
-- Name: orders orders_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_search_vector_trig BEFORE INSERT OR UPDATE OF order_number, invoice_number, customer_name, customer_email, customer_phone ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_search_vector_update();



--
-- Name: products products_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_search_vector_trig BEFORE INSERT OR UPDATE OF name, sku, short_description, description ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_search_vector_update();



--
-- Name: quotations quotations_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quotations_search_vector_trig BEFORE INSERT OR UPDATE OF quote_number, consignee_name, consignee_gstin, buyer_name ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_search_vector_update();



--
-- Name: brands trg_audit_brands; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_brands AFTER INSERT OR DELETE OR UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: campaigns trg_audit_campaigns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_campaigns AFTER INSERT OR DELETE OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: categories trg_audit_categories; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_categories AFTER INSERT OR DELETE OR UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: coupons trg_audit_coupons; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_coupons AFTER INSERT OR DELETE OR UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: custom_scenarios trg_audit_custom_scenarios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_custom_scenarios AFTER INSERT OR DELETE OR UPDATE ON public.custom_scenarios FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: customer_tag_definitions trg_audit_customer_tag_definitions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_customer_tag_definitions AFTER INSERT OR DELETE OR UPDATE ON public.customer_tag_definitions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: email_campaigns trg_audit_email_campaigns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_email_campaigns AFTER INSERT OR DELETE OR UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: expense_payments trg_audit_expense_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expense_payments AFTER INSERT OR DELETE OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: expenses trg_audit_expenses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expenses AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: gallery_images trg_audit_gallery_images; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_gallery_images AFTER INSERT OR DELETE OR UPDATE ON public.gallery_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: grn_items trg_audit_grn_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_grn_items AFTER INSERT OR DELETE OR UPDATE ON public.grn_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: grns trg_audit_grns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_grns AFTER INSERT OR DELETE OR UPDATE ON public.grns FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: price_inflation_log trg_audit_price_inflation_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_price_inflation_log AFTER INSERT OR DELETE OR UPDATE ON public.price_inflation_log FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: product_images trg_audit_product_images; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_images AFTER INSERT OR DELETE OR UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: product_sub_variants trg_audit_product_sub_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_sub_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_sub_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: product_variants trg_audit_product_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: products trg_audit_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: purchase_order_items trg_audit_purchase_order_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_order_items AFTER INSERT OR DELETE OR UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: purchase_orders trg_audit_purchase_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_orders AFTER INSERT OR DELETE OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: review_forms trg_audit_review_forms; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_review_forms AFTER INSERT OR DELETE OR UPDATE ON public.review_forms FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: scenarios trg_audit_scenarios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_scenarios AFTER INSERT OR DELETE OR UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: shelf_locations trg_audit_shelf_locations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shelf_locations AFTER INSERT OR DELETE OR UPDATE ON public.shelf_locations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: shelf_stock trg_audit_shelf_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shelf_stock AFTER INSERT OR DELETE OR UPDATE ON public.shelf_stock FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: shipping_zones trg_audit_shipping_zones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shipping_zones AFTER INSERT OR DELETE OR UPDATE ON public.shipping_zones FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: suppliers trg_audit_suppliers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_suppliers AFTER INSERT OR DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: variant_images trg_audit_variant_images; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_variant_images AFTER INSERT OR DELETE OR UPDATE ON public.variant_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: warehouses trg_audit_warehouses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_warehouses AFTER INSERT OR DELETE OR UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: cash_sales trig_cash_sales_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_cash_sales_search_vector BEFORE INSERT OR UPDATE ON public.cash_sales FOR EACH ROW EXECUTE FUNCTION public.cash_sales_search_vector_update();



--
-- Name: addresses update_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_addresses_updated_at BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: customer_profiles update_customer_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: product_images update_product_images_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_product_images_updated_at BEFORE UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: products update_products_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_search_vector BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_product_search_vector();



--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

