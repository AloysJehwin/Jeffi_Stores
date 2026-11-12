-- storefront-service: triggers. Load order comes from scripts/db-files.mjs.

--
-- Name: product_views increment_product_views_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER increment_product_views_trigger AFTER INSERT ON public.product_views FOR EACH ROW EXECUTE FUNCTION public.increment_product_views();



--
-- Name: order_items trg_audit_order_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_order_items AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('product_id,variant_id,sub_variant_id,product_name,variant_name,sub_variant_name,quantity,unit_price,mrp,discount_amount,total_price,buy_unit,access_revoked_at', 'order_id');



--
-- Name: subscriptions trg_audit_subscriptions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_subscriptions AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,quantity,variant_id,sub_variant_id,interval,interval_count,unit_price_ex_gst,unit_price_paise,shipping_paise,address_id,current_cycle,next_renewal_at,access_expires_at,cancel_at_cycle_end,paused_at,cancelled_at,min_cycles,term_cycles', '');



--
-- Name: users trg_audit_users; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_users AFTER UPDATE ON public.users FOR EACH ROW WHEN ((NOT COALESCE(new.is_guest, false))) EXECUTE FUNCTION public.audit_row_change('email,phone,first_name,last_name,is_active,is_flagged,flag_reason,marketing_opt_out,user_type,notification_channel,phone_verified,date_of_birth,deleted_at', '');



--
-- Name: addresses update_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_addresses_updated_at BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
