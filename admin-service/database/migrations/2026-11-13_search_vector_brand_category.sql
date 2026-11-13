-- Products' search_vector now includes brand, category and parent category names. Two triggers used to
-- rewrite it (the second one won); keep one. The schema diff applies no functions or triggers, so this
-- file does. Safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_product_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_brand text;
    v_category text;
BEGIN
    SELECT b.name INTO v_brand FROM public.brands b WHERE b.id = NEW.brand_id;
    SELECT concat_ws(' ', c.name, pc.name) INTO v_category
      FROM public.categories c LEFT JOIN public.categories pc ON pc.id = c.parent_category_id
     WHERE c.id = NEW.category_id;
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(v_brand, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(v_category, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.short_description, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.sku, '')), 'C');
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_product_search_vectors() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_skip text := current_setting('audit.skip', true);
BEGIN
    PERFORM set_config('audit.skip', 'true', true);
    IF TG_TABLE_NAME = 'brands' THEN
        UPDATE public.products SET search_vector = NULL WHERE brand_id = NEW.id;
    ELSE
        UPDATE public.products SET search_vector = NULL
         WHERE category_id = NEW.id
            OR category_id IN (SELECT c.id FROM public.categories c WHERE c.parent_category_id = NEW.id);
    END IF;
    PERFORM set_config('audit.skip', COALESCE(v_skip, ''), true);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS products_search_vector_trig ON public.products;
DROP FUNCTION IF EXISTS public.products_search_vector_update();

DROP TRIGGER IF EXISTS update_products_search_vector ON public.products;
CREATE TRIGGER update_products_search_vector BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_product_search_vector();

DROP TRIGGER IF EXISTS trg_brands_search_vector ON public.brands;
CREATE TRIGGER trg_brands_search_vector AFTER UPDATE OF name ON public.brands FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION public.refresh_product_search_vectors();

DROP TRIGGER IF EXISTS trg_categories_search_vector ON public.categories;
CREATE TRIGGER trg_categories_search_vector AFTER UPDATE OF name, parent_category_id ON public.categories FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.parent_category_id IS DISTINCT FROM NEW.parent_category_id) EXECUTE FUNCTION public.refresh_product_search_vectors();

-- Re-index existing rows (the BEFORE trigger recomputes); no audit row per product.
SET LOCAL audit.skip = 'true';
UPDATE public.products SET search_vector = NULL;

COMMIT;
