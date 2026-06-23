-- Migration: replace narrow cart_items unique constraint with one that covers
-- sub_variant_id and buy_mode, enabling the atomic INSERT ... ON CONFLICT upsert
-- in /api/cart (POST).
--
-- PG 14 does not support NULLS NOT DISTINCT, so we use a unique index on
-- COALESCE sentinel values instead. The cart upsert uses ON CONFLICT on the
-- same expression to match.

BEGIN;

ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_variant_id_key,
  DROP CONSTRAINT IF EXISTS cart_items_user_product_variant_subvariant_key;

DROP INDEX IF EXISTS public.cart_items_upsert_key;

-- Sentinel UUIDs represent NULL for the nullable FK columns so that NULL
-- values are treated as equal (standard UNIQUE treats NULLs as distinct).
CREATE UNIQUE INDEX cart_items_upsert_key ON public.cart_items (
  user_id,
  product_id,
  COALESCE(variant_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(sub_variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
  buy_mode
);

COMMIT;
