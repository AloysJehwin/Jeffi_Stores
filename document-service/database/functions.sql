-- document-service: functions. Load order comes from scripts/db-files.mjs.

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
