-- Brand / category profile (docs/BRAND_CATEGORY_PLAN.md Phase 1): the brands updated_at trigger the
-- schema diff does not create, and category tax defaults taken from their products. Safe to run twice.

UPDATE public.brands SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS update_brands_updated_at ON public.brands;
CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- HSN / GST default = the value at least 80% of a category's products share; mixed categories stay empty.
WITH hsn AS (
  SELECT category_id, hsn_code, count(*) AS n, sum(count(*)) OVER (PARTITION BY category_id) AS total,
         row_number() OVER (PARTITION BY category_id ORDER BY count(*) DESC, hsn_code) AS rk
    FROM public.products
   WHERE category_id IS NOT NULL AND NULLIF(btrim(hsn_code), '') IS NOT NULL
   GROUP BY category_id, hsn_code
)
UPDATE public.categories c
   SET default_hsn_code = left(regexp_replace(h.hsn_code, '\D', '', 'g'), 8)
  FROM hsn h
 WHERE h.category_id = c.id AND h.rk = 1 AND h.n >= 0.8 * h.total
   AND c.default_hsn_code IS NULL
   AND length(regexp_replace(h.hsn_code, '\D', '', 'g')) >= 4;

WITH gst AS (
  SELECT category_id, gst_percentage, count(*) AS n, sum(count(*)) OVER (PARTITION BY category_id) AS total,
         row_number() OVER (PARTITION BY category_id ORDER BY count(*) DESC, gst_percentage) AS rk
    FROM public.products
   WHERE category_id IS NOT NULL AND gst_percentage IS NOT NULL
   GROUP BY category_id, gst_percentage
)
UPDATE public.categories c
   SET default_gst_rate = g.gst_percentage
  FROM gst g
 WHERE g.category_id = c.id AND g.rk = 1 AND g.n >= 0.8 * g.total
   AND c.default_gst_rate IS NULL;
