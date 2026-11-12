-- admin-service: triggers. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: product_images check_product_image_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_product_image_limit BEFORE INSERT ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.validate_product_image_limit();



--
-- Name: orders orders_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_search_vector_trig BEFORE INSERT OR UPDATE OF order_number, invoice_number, customer_name, customer_email, customer_phone ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_search_vector_update();



--
-- Name: products products_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_search_vector_trig BEFORE INSERT OR UPDATE OF name, sku, short_description, description ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_search_vector_update();



--
-- Name: brands trg_audit_brands; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_brands AFTER INSERT OR DELETE OR UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: business_discounts trg_audit_business_discounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_business_discounts AFTER INSERT OR DELETE OR UPDATE ON public.business_discounts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('category_id,discount_pct', 'user_id');



--
-- Name: business_profiles trg_audit_business_profiles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_business_profiles AFTER INSERT OR DELETE OR UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('company_name,gst_number,business_address,industry,approval_status,approved_by,rejection_note', 'user_id');



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
-- Name: customer_profiles trg_audit_customer_profiles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_customer_profiles AFTER INSERT OR DELETE OR UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('company_name,gst_number,customer_type,credit_limit', 'user_id');



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

CREATE TRIGGER trg_audit_expense_payments AFTER INSERT OR DELETE OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'expense_id');



--
-- Name: expenses trg_audit_expenses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expenses AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: gallery_images trg_audit_gallery_images; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_gallery_images AFTER INSERT OR DELETE OR UPDATE ON public.gallery_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: orders trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,payment_status,shipment_status,payment_mode,payment_link_status,shipping_method,tracking_number,tracking_url,awb_number,subtotal,discount_amount,business_discount_amount,tax_amount,shipping_amount,cod_fee_amount,total_amount,notes,admin_notes,cancellation_note,customer_name,customer_email,customer_phone,buyer_gstin,shipping_address_snapshot,billing_address_snapshot,invoice_number,irn_status,eway_bill_no,estimated_delivery_date,needs_delivery', '');



--
-- Name: price_inflation_log trg_audit_price_inflation_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_price_inflation_log AFTER INSERT OR DELETE OR UPDATE ON public.price_inflation_log FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: product_images trg_audit_product_images; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_images AFTER INSERT OR DELETE OR UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');



--
-- Name: product_offers trg_audit_product_offers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_offers AFTER INSERT OR DELETE OR UPDATE ON public.product_offers FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('slug,title,subtitle,badge_text,badge_color,image_url,image_url_mobile,image_url_card,video_url,video_url_card,cta_label,starts_at,ends_at,display_order,is_active', '');



--
-- Name: product_sub_variants trg_audit_product_sub_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_sub_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_sub_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');



--
-- Name: product_variants trg_audit_product_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');



--
-- Name: products trg_audit_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: review_forms trg_audit_review_forms; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_review_forms AFTER INSERT OR DELETE OR UPDATE ON public.review_forms FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: scenarios trg_audit_scenarios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_scenarios AFTER INSERT OR DELETE OR UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();



--
-- Name: shelf_stock trg_audit_shelf_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shelf_stock AFTER INSERT OR DELETE OR UPDATE ON public.shelf_stock FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');



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
-- Name: product_media trg_audit_product_media; Type: TRIGGER; Schema: public; Owner: -
-- sort_order is left out of the diff: a reorder alone is not a change-log entry.
--

CREATE TRIGGER trg_audit_product_media AFTER INSERT OR DELETE OR UPDATE ON public.product_media FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('kind,url,thumbnail_url,alt,caption,is_primary,status', 'root_product_id');


--
-- Name: product_faqs trg_audit_product_faqs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_faqs AFTER INSERT OR DELETE OR UPDATE ON public.product_faqs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('question,answer,published', 'product_id');
