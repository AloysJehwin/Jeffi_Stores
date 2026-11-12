-- business-service: triggers. Load order comes from scripts/db-files.mjs.

--
-- Name: business_rfqs trg_audit_business_rfqs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_business_rfqs AFTER INSERT OR DELETE OR UPDATE ON public.business_rfqs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,notes,admin_note,converted_quotation_id,reviewed_by', '');
