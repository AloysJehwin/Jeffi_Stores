-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: audit_label_for(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_label_for(col_name text, val_text text) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
  v_lookup_table TEXT;
  v_display_expr TEXT;
  v_result TEXT;
  v_uuid UUID;
BEGIN
  IF val_text IS NULL OR val_text = '' OR val_text = 'null' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_uuid := val_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  -- Admin actor columns: resolve display name via the linked users row
  -- (admins.username was removed; identity now lives on users).
  IF col_name IN ('admin_id', 'created_by', 'updated_by', 'completed_by', 'assigned_to') THEN
    BEGIN
      SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email)
        INTO v_result
        FROM public.admins a JOIN public.users u ON u.id = a.user_id
       WHERE a.id = v_uuid LIMIT 1;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    RETURN v_result;
  END IF;

  CASE
    WHEN col_name IN ('category_id', 'parent_category_id', 'parent_id') THEN
      v_lookup_table := 'categories'; v_display_expr := 'name';
    WHEN col_name = 'brand_id' THEN
      v_lookup_table := 'brands'; v_display_expr := 'name';
    WHEN col_name = 'product_id' THEN
      v_lookup_table := 'products'; v_display_expr := 'name';
    WHEN col_name = 'variant_id' THEN
      v_lookup_table := 'product_variants'; v_display_expr := 'variant_name';
    WHEN col_name = 'sub_variant_id' THEN
      v_lookup_table := 'product_sub_variants'; v_display_expr := 'sub_variant_name';
    WHEN col_name = 'supplier_id' THEN
      v_lookup_table := 'suppliers'; v_display_expr := 'name';
    WHEN col_name = 'coupon_id' THEN
      v_lookup_table := 'coupons'; v_display_expr := 'code';
    WHEN col_name = 'user_id' THEN
      v_lookup_table := 'users'; v_display_expr := 'email';
    ELSE
      RETURN NULL;
  END CASE;

  IF to_regclass(v_lookup_table) IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    EXECUTE format('SELECT %I::text FROM %I WHERE id = $1 LIMIT 1', v_display_expr, v_lookup_table)
      INTO v_result USING v_uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  RETURN v_result;
END;
$_$;



--
-- Name: audit_row_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_row_change() RETURNS trigger
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
BEGIN
  BEGIN
    v_admin_id := NULLIF(current_setting('audit.admin_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_admin_id := NULL;
  END;

  v_inflation_id := NULLIF(current_setting('audit.inflation_id', true), '');

  IF NULLIF(current_setting('audit.skip', true), '') = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
      IF k IN ('updated_at', 'created_at') THEN CONTINUE; END IF;
      IF k IN (
        'views_count', 'sales_count', 'search_vector',
        'ai_description', 'ai_use_cases', 'ai_enriched_at', 'ai_score',
        'last_viewed_at', 'last_login', 'last_purchased_at', 'last_computed_at',
        'embedding', 'embedding_text', 'content_hash',
        'inventory_quantity'
      ) THEN CONTINUE; END IF;
      IF k LIKE 'last\_%' ESCAPE '\' THEN CONTINUE; END IF;
      IF k LIKE '%\_count' ESCAPE '\' THEN CONTINUE; END IF;
      IF k LIKE 'ai\_%' ESCAPE '\' THEN CONTINUE; END IF;
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
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'variant_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'sub_variant_name',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'sku',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'code',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'slug',
    (CASE TG_OP WHEN 'DELETE' THEN v_old_json ELSE v_new_json END)->>'file_name',
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
        EXECUTE 'SELECT p.name, v.variant_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1'
          INTO v_pname, v_vname USING v_vid::uuid;
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



--
-- Name: cash_sales_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_sales_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('simple', coalesce(NEW.sale_number, '')) ||
    to_tsvector('simple', coalesce(NEW.invoice_number, '')) ||
    to_tsvector('simple', coalesce(NEW.customer_name, ''));
  RETURN NEW;
END;
$$;



--
-- Name: cleanup_old_guest_users(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_guest_users(days_old integer DEFAULT 30) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM users
  WHERE is_guest = TRUE
    AND created_at < NOW() - (days_old || ' days')::INTERVAL
    AND id NOT IN (SELECT DISTINCT user_id FROM cart_items)
    AND id NOT IN (SELECT DISTINCT user_id FROM wishlist_items);
END;
$$;



--
-- Name: increment_product_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_product_views() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE products SET views_count = views_count + 1 WHERE id = NEW.product_id;
    RETURN NEW;
END;
$$;



--
-- Name: merge_guest_cart_to_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_guest_cart_to_user(p_guest_user_id uuid, p_actual_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO cart_items (user_id, product_id, variant_id, sub_variant_id, quantity, price_at_addition, created_at, updated_at)
  SELECT
    p_actual_user_id,
    product_id,
    variant_id,
    sub_variant_id,
    quantity,
    price_at_addition,
    created_at,
    updated_at
  FROM cart_items
  WHERE user_id = p_guest_user_id
  ON CONFLICT (user_id, product_id, variant_id, sub_variant_id)
  DO UPDATE SET
    quantity = cart_items.quantity + EXCLUDED.quantity,
    updated_at = NOW();

  DELETE FROM cart_items WHERE user_id = p_guest_user_id;

  INSERT INTO wishlist_items (user_id, product_id, created_at)
  SELECT
    p_actual_user_id,
    product_id,
    created_at
  FROM wishlist_items
  WHERE user_id = p_guest_user_id
  ON CONFLICT (user_id, product_id) DO NOTHING;

  DELETE FROM wishlist_items WHERE user_id = p_guest_user_id;

  UPDATE users
  SET
    merged_to_user_id = p_actual_user_id,
    updated_at = NOW()
  WHERE id = p_guest_user_id;
END;
$$;



--
-- Name: orders_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.order_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.invoice_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_phone, '')), 'B');
  RETURN NEW;
END
$$;



--
-- Name: products_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.products_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.sku, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.short_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END
$$;



--
-- Name: quotations_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quotations_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.quote_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_gstin, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.buyer_name, '')), 'C');
  RETURN NEW;
END
$$;



--
-- Name: update_product_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.sku, '')), 'C');
    RETURN NEW;
END;
$$;



--
-- Name: update_product_stock_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_stock_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.is_in_stock := NEW.stock_quantity > 0;
    RETURN NEW;
END;
$$;



--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;



--
-- Name: validate_product_image_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_product_image_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    image_count INT;
BEGIN
    SELECT COUNT(*) INTO image_count
    FROM product_images
    WHERE product_id = NEW.product_id;

    IF image_count >= 5 THEN
        RAISE EXCEPTION 'Cannot add more than 5 images per product';
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;
