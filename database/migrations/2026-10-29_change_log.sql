-- Change log on every admin view page.
-- audit_row_change() takes optional args (columns to diff, parent column) and records the non-admin
-- actor; orders, invoices, quotations, cash sales, RFQs, subscriptions, offers and customers get
-- audit triggers; child-table triggers record their parent; existing child rows get parent_id.
--
-- Idempotent + transactional. Function and trigger changes ship here because the schema diff
-- never applies them; database/functions.sql and triggers.sql hold the same definitions.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_admin_id UUID;
  v_action TEXT;
  v_entity_id TEXT;
  v_diff JSONB := '{}'::jsonb;
  v_summary TEXT;
  v_old_json JSONB;
  v_new_json JSONB;
  k TEXT;
  v_name TEXT;
  v_old_val JSONB;
  v_new_val JSONB;
  v_old_text TEXT;
  v_new_text TEXT;
  v_from_label TEXT;
  v_to_label TEXT;
  v_field_obj JSONB;
  v_inflation_id TEXT;
  v_extra_meta JSONB;
  v_cols TEXT[];
  v_parent_col TEXT;
  v_parent TEXT;
  v_actor TEXT;
  v_row JSONB;
BEGIN
  BEGIN
    v_admin_id := NULLIF(current_setting('audit.admin_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_admin_id := NULL;
  END;

  v_inflation_id := NULLIF(current_setting('audit.inflation_id', true), '');
  v_actor := NULLIF(current_setting('audit.actor', true), '');

  IF NULLIF(current_setting('audit.skip', true), '') = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Optional args: the only columns to diff (comma list), and the parent column(s) ('a|b' = first set)
  -- whose value goes in metadata.parent_id so the row shows on its parent's change log.
  IF TG_NARGS > 0 AND TG_ARGV[0] <> '' THEN v_cols := string_to_array(TG_ARGV[0], ','); END IF;
  IF TG_NARGS > 1 AND TG_ARGV[1] <> '' THEN v_parent_col := TG_ARGV[1]; END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new_json := to_jsonb(NEW);
    v_entity_id := COALESCE(v_new_json->>'id', v_new_json->>'kind', v_new_json->>'key', '');
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    v_entity_id := COALESCE(v_new_json->>'id', v_new_json->>'kind', v_new_json->>'key', '');
    FOR k IN SELECT jsonb_object_keys(v_new_json) LOOP
      IF v_cols IS NOT NULL THEN
        IF NOT (k = ANY(v_cols)) THEN CONTINUE; END IF;
      ELSIF k IN ('updated_at', 'created_at') THEN CONTINUE;
      ELSIF k IN (
        'views_count', 'sales_count', 'search_vector',
        'ai_description', 'ai_use_cases', 'ai_enriched_at', 'ai_score',
        'last_viewed_at', 'last_login', 'last_purchased_at', 'last_computed_at',
        'embedding', 'embedding_text', 'content_hash',
        'inventory_quantity'
      ) THEN CONTINUE;
      ELSIF k LIKE 'last\_%' ESCAPE '\' THEN CONTINUE;
      ELSIF k LIKE '%\_count' ESCAPE '\' THEN CONTINUE;
      ELSIF k LIKE 'ai\_%' ESCAPE '\' THEN CONTINUE;
      END IF;
      v_old_val := v_old_json -> k;
      v_new_val := v_new_json -> k;
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        v_old_text := v_old_json ->> k;
        v_new_text := v_new_json ->> k;
        v_from_label := audit_label_for(k, v_old_text);
        v_to_label   := audit_label_for(k, v_new_text);
        v_field_obj := jsonb_build_object('from', v_old_val, 'to', v_new_val);
        IF v_from_label IS NOT NULL THEN v_field_obj := v_field_obj || jsonb_build_object('fromLabel', v_from_label); END IF;
        IF v_to_label   IS NOT NULL THEN v_field_obj := v_field_obj || jsonb_build_object('toLabel',   v_to_label);   END IF;
        v_diff := v_diff || jsonb_build_object(k, v_field_obj);
      END IF;
    END LOOP;
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old_json := to_jsonb(OLD);
    v_entity_id := COALESCE(v_old_json->>'id', v_old_json->>'kind', v_old_json->>'key', '');
  END IF;

  v_name := COALESCE(
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'title',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'variant_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'sub_variant_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'sku',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'code',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'slug',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'file_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'order_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'invoice_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'quote_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'rfq_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'sale_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'expense_number',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'email',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'company_name',
    left((CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'description', 60),
    v_entity_id
  );

  IF TG_TABLE_NAME = 'product_images' THEN
    DECLARE
      v_pid TEXT;
      v_pname TEXT;
    BEGIN
      v_pid := (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_id';
      IF v_pid IS NOT NULL THEN
        EXECUTE 'SELECT name FROM products WHERE id = $1' INTO v_pname USING v_pid::uuid;
      END IF;
      v_summary := initcap(v_action) || ' image for "' || COALESCE(v_pname, 'unknown product') || '"';
    END;
  ELSIF TG_TABLE_NAME = 'variant_images' THEN
    DECLARE
      v_vid TEXT;
      v_pname TEXT;
      v_vname TEXT;
    BEGIN
      v_vid := (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'variant_id';
      IF v_vid IS NOT NULL THEN
        EXECUTE 'SELECT p.name, v.variant_name, p.id::text FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1'
          INTO v_pname, v_vname, v_parent USING v_vid::uuid;
      END IF;
      v_summary := initcap(v_action) || ' variant image for "' || COALESCE(v_pname, 'unknown product') ||
        '" / ' || COALESCE(v_vname, 'unknown variant');
    END;
  ELSIF TG_TABLE_NAME IN ('product_variants', 'product_sub_variants') THEN
    DECLARE
      v_pid TEXT;
      v_pname TEXT;
      v_label TEXT;
    BEGIN
      v_pid := (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_id';
      IF v_pid IS NOT NULL THEN
        EXECUTE 'SELECT name FROM products WHERE id = $1' INTO v_pname USING v_pid::uuid;
      END IF;
      v_label := CASE WHEN TG_TABLE_NAME = 'product_variants' THEN 'variant' ELSE 'sub-variant' END;
      v_summary := initcap(v_action) || ' ' || v_label || ' "' || v_name || '"' ||
        CASE WHEN v_pname IS NOT NULL THEN ' on "' || v_pname || '"' ELSE '' END;
    END;
  ELSE
    v_summary := initcap(v_action) || ' ' || TG_TABLE_NAME || ' "' || v_name || '"';
  END IF;

  v_extra_meta := CASE
    WHEN TG_TABLE_NAME = 'product_images' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'image_url', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'image_url',
        'thumbnail_url', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'thumbnail_url',
        'file_name', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'file_name',
        'product_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_id'
      )
    WHEN TG_TABLE_NAME = 'variant_images' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'image_url', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'image_url',
        'thumbnail_url', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'thumbnail_url',
        'file_name', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'file_name',
        'variant_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'variant_id'
      )
    WHEN TG_TABLE_NAME IN ('product_variants', 'product_sub_variants') THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'product_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_id'
      )
    WHEN TG_TABLE_NAME = 'purchase_order_items' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'po_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'po_id'
      )
    WHEN TG_TABLE_NAME = 'grn_items' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'grn_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'grn_id'
      )
    WHEN TG_TABLE_NAME = 'expense_payments' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'expense_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'expense_id'
      )
    WHEN TG_TABLE_NAME = 'shelf_stock' THEN
      jsonb_build_object(
        'op', TG_OP,
        'auto', true,
        'location_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'location_id',
        'product_id', (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'product_id'
      )
    ELSE
      jsonb_build_object('op', TG_OP, 'auto', true)
  END;

  IF v_inflation_id IS NOT NULL THEN
    v_extra_meta := v_extra_meta || jsonb_build_object('inflation_id', v_inflation_id);
  END IF;

  IF v_parent_col IS NOT NULL THEN
    v_row := CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END;
    SELECT v_row->>c INTO v_parent FROM unnest(string_to_array(v_parent_col, '|')) c WHERE v_row->>c IS NOT NULL LIMIT 1;
  END IF;
  IF v_parent IS NOT NULL THEN
    v_extra_meta := v_extra_meta || jsonb_build_object('parent_id', v_parent);
  END IF;
  IF v_actor IS NOT NULL THEN
    v_extra_meta := v_extra_meta || jsonb_build_object('actor', v_actor);
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, summary, diff, metadata)
  VALUES (
    v_admin_id,
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    v_summary,
    CASE WHEN v_diff = '{}'::jsonb THEN NULL ELSE v_diff END,
    v_extra_meta
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN others THEN
  RETURN COALESCE(NEW, OLD);
END;
$_$;

DO $$
BEGIN
  IF to_regclass('public.business_rfqs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_business_rfqs ON public.business_rfqs;
    CREATE TRIGGER trg_audit_business_rfqs AFTER INSERT OR DELETE OR UPDATE ON public.business_rfqs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,notes,admin_note,converted_quotation_id,reviewed_by', '');
  END IF;
  IF to_regclass('public.business_discounts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_business_discounts ON public.business_discounts;
    CREATE TRIGGER trg_audit_business_discounts AFTER INSERT OR DELETE OR UPDATE ON public.business_discounts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('category_id,discount_pct', 'user_id');
  END IF;
  IF to_regclass('public.business_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_business_profiles ON public.business_profiles;
    CREATE TRIGGER trg_audit_business_profiles AFTER INSERT OR DELETE OR UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('company_name,gst_number,business_address,industry,approval_status,approved_by,rejection_note', 'user_id');
  END IF;
  IF to_regclass('public.cash_sale_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_cash_sale_items ON public.cash_sale_items;
    CREATE TRIGGER trg_audit_cash_sale_items AFTER INSERT OR DELETE OR UPDATE ON public.cash_sale_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('product_id,variant_id,sub_variant_id,product_name,variant_name,quantity,unit_price,discount_amount,total_price,buy_unit', 'sale_id');
  END IF;
  IF to_regclass('public.cash_sales') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_cash_sales ON public.cash_sales;
    CREATE TRIGGER trg_audit_cash_sales AFTER INSERT OR DELETE OR UPDATE ON public.cash_sales FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,customer_name,customer_phone,payment_mode,payment_status,subtotal,tax_amount,total_amount,notes,invoice_number', '');
  END IF;
  IF to_regclass('public.customer_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_customer_profiles ON public.customer_profiles;
    CREATE TRIGGER trg_audit_customer_profiles AFTER INSERT OR DELETE OR UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('company_name,gst_number,customer_type,credit_limit', 'user_id');
  END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_invoices ON public.invoices;
    CREATE TRIGGER trg_audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invoice_number,status,pdf_url', 'order_id|sale_id');
  END IF;
  IF to_regclass('public.order_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_order_items ON public.order_items;
    CREATE TRIGGER trg_audit_order_items AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('product_id,variant_id,sub_variant_id,product_name,variant_name,sub_variant_name,quantity,unit_price,mrp,discount_amount,total_price,buy_unit,access_revoked_at', 'order_id');
  END IF;
  IF to_regclass('public.orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
    CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,payment_status,shipment_status,payment_mode,payment_link_status,shipping_method,tracking_number,tracking_url,awb_number,subtotal,discount_amount,business_discount_amount,tax_amount,shipping_amount,cod_fee_amount,total_amount,notes,admin_notes,cancellation_note,customer_name,customer_email,customer_phone,buyer_gstin,shipping_address_snapshot,billing_address_snapshot,invoice_number,irn_status,eway_bill_no,estimated_delivery_date,needs_delivery', '');
  END IF;
  IF to_regclass('public.product_offers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_product_offers ON public.product_offers;
    CREATE TRIGGER trg_audit_product_offers AFTER INSERT OR DELETE OR UPDATE ON public.product_offers FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('slug,title,subtitle,badge_text,badge_color,image_url,image_url_mobile,image_url_card,video_url,video_url_card,cta_label,starts_at,ends_at,display_order,is_active', '');
  END IF;
  IF to_regclass('public.quotation_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_quotation_items ON public.quotation_items;
    CREATE TRIGGER trg_audit_quotation_items AFTER INSERT OR DELETE OR UPDATE ON public.quotation_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('description,product_id,variant_id,sub_variant_id,quantity,unit,rate,discount_pct,gst_rate,hsn_code,amount', 'quotation_id');
  END IF;
  IF to_regclass('public.quotations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_quotations ON public.quotations;
    CREATE TRIGGER trg_audit_quotations AFTER INSERT OR DELETE OR UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,quote_date,consignee_name,consignee_gstin,consignee_phone,consignee_email,consignee_addr1,consignee_addr2,consignee_city,consignee_state,consignee_pincode,buyer_name,buyer_gstin,buyer_phone,buyer_email,buyer_addr1,buyer_addr2,buyer_city,buyer_state,buyer_pincode,notes,subtotal,cgst_amount,sgst_amount,total_amount,converted_order_id', '');
  END IF;
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_subscriptions ON public.subscriptions;
    CREATE TRIGGER trg_audit_subscriptions AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('status,quantity,variant_id,sub_variant_id,interval,interval_count,unit_price_ex_gst,unit_price_paise,shipping_paise,address_id,current_cycle,next_renewal_at,access_expires_at,cancel_at_cycle_end,paused_at,cancelled_at,min_cycles,term_cycles', '');
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_users ON public.users;
    CREATE TRIGGER trg_audit_users AFTER UPDATE ON public.users FOR EACH ROW WHEN ((NOT COALESCE(new.is_guest, false))) EXECUTE FUNCTION public.audit_row_change('email,phone,first_name,last_name,is_active,is_flagged,flag_reason,marketing_opt_out,user_type,notification_channel,phone_verified,date_of_birth,deleted_at', '');
  END IF;
  IF to_regclass('public.expense_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_expense_payments ON public.expense_payments;
    CREATE TRIGGER trg_audit_expense_payments AFTER INSERT OR DELETE OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'expense_id');
  END IF;
  IF to_regclass('public.grn_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_grn_items ON public.grn_items;
    CREATE TRIGGER trg_audit_grn_items AFTER INSERT OR DELETE OR UPDATE ON public.grn_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'grn_id');
  END IF;
  IF to_regclass('public.product_images') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_product_images ON public.product_images;
    CREATE TRIGGER trg_audit_product_images AFTER INSERT OR DELETE OR UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');
  END IF;
  IF to_regclass('public.product_sub_variants') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_product_sub_variants ON public.product_sub_variants;
    CREATE TRIGGER trg_audit_product_sub_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_sub_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');
  END IF;
  IF to_regclass('public.product_variants') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_product_variants ON public.product_variants;
    CREATE TRIGGER trg_audit_product_variants AFTER INSERT OR DELETE OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');
  END IF;
  IF to_regclass('public.purchase_order_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_purchase_order_items ON public.purchase_order_items;
    CREATE TRIGGER trg_audit_purchase_order_items AFTER INSERT OR DELETE OR UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'po_id');
  END IF;
  IF to_regclass('public.shelf_stock') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_shelf_stock ON public.shelf_stock;
    CREATE TRIGGER trg_audit_shelf_stock AFTER INSERT OR DELETE OR UPDATE ON public.shelf_stock FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'product_id');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_audit_parent ON public.admin_audit_log USING btree (((metadata ->> 'parent_id'::text)), created_at DESC) WHERE (metadata ? 'parent_id'::text);

-- Existing child rows: their parent key, under the one name the change log reads.
UPDATE public.admin_audit_log
   SET metadata = metadata || jsonb_build_object('parent_id', metadata->>'product_id')
 WHERE entity_type IN ('product_variants', 'product_sub_variants', 'product_images', 'shelf_stock')
   AND metadata ? 'product_id' AND NOT metadata ? 'parent_id';
UPDATE public.admin_audit_log
   SET metadata = metadata || jsonb_build_object('parent_id', metadata->>'po_id')
 WHERE entity_type = 'purchase_order_items' AND metadata ? 'po_id' AND NOT metadata ? 'parent_id';
UPDATE public.admin_audit_log
   SET metadata = metadata || jsonb_build_object('parent_id', metadata->>'grn_id')
 WHERE entity_type = 'grn_items' AND metadata ? 'grn_id' AND NOT metadata ? 'parent_id';
UPDATE public.admin_audit_log
   SET metadata = metadata || jsonb_build_object('parent_id', metadata->>'expense_id')
 WHERE entity_type = 'expense_payments' AND metadata ? 'expense_id' AND NOT metadata ? 'parent_id';
UPDATE public.admin_audit_log l
   SET metadata = l.metadata || jsonb_build_object('parent_id', v.product_id::text)
  FROM public.product_variants v
 WHERE l.entity_type = 'variant_images' AND NOT l.metadata ? 'parent_id'
   AND v.id::text = l.metadata->>'variant_id';

COMMIT;
