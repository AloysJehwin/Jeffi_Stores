-- storefront-service: functions. Load order comes from scripts/db-files.mjs.

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
