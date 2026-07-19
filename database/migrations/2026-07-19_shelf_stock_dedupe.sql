-- ============================================================================
-- Migration: fix duplicate shelf_stock rows + prevent recurrence (PG14-safe)
--
-- shelf_stock_unique is a plain UNIQUE(location_id, product_id, variant_id,
-- sub_variant_id). On PostgreSQL <15, NULLs compare as DISTINCT, so that index
-- never blocks duplicates when sub_variant_id (and/or variant_id) IS NULL —
-- the common case. Stale/duplicate rows accumulated as a result (e.g. a
-- "0.000" row beside the real quantity; an exact double-counted row), and
-- syncPerishableStock (which keys its dedup map by location_id alone) cannot
-- self-heal them.
--
-- This migration:
--   1) Collapses each duplicate natural-key group to the row with the greatest
--      quantity (the live value; extras are stale zeros or exact double-counts).
--   2) Adds partial unique indexes covering the NULL patterns so duplicates can
--      never form again on PG14.
--
-- Idempotent and safe to re-run. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/2026-07-19_shelf_stock_dedupe.sql
-- ============================================================================

BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY location_id, product_id,
                        COALESCE(variant_id,     '00000000-0000-0000-0000-000000000000'::uuid),
                        COALESCE(sub_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY quantity DESC, updated_at DESC, id
         ) AS rn
  FROM shelf_stock
)
DELETE FROM shelf_stock
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS shelf_stock_uniq_var_no_subvar
  ON public.shelf_stock (location_id, product_id, variant_id)
  WHERE sub_variant_id IS NULL AND variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shelf_stock_uniq_product_only
  ON public.shelf_stock (location_id, product_id)
  WHERE variant_id IS NULL AND sub_variant_id IS NULL;

COMMIT;
