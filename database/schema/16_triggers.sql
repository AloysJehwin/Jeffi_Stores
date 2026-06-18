-- Module: 16_triggers
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
-- Name: products update_products_stock_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_stock_status BEFORE INSERT OR UPDATE OF stock_status ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_product_stock_status();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


