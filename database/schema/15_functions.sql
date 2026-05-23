-- Module: 15_functions
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
  INSERT INTO cart_items (user_id, product_id, variant_id, quantity, price_at_addition, created_at, updated_at)
  SELECT
    p_actual_user_id,
    product_id,
    variant_id,
    quantity,
    price_at_addition,
    created_at,
    updated_at
  FROM cart_items
  WHERE user_id = p_guest_user_id
  ON CONFLICT (user_id, product_id, variant_id)
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

