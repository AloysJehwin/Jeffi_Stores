-- Migration: replace narrow cart_items unique constraint with one that covers
-- sub_variant_id and buy_mode, enabling the atomic INSERT ... ON CONFLICT upsert
-- in /api/cart (POST).
--
-- NULLS NOT DISTINCT ensures rows where variant_id/sub_variant_id are NULL still
-- conflict correctly (standard UNIQUE treats NULLs as distinct, which would allow
-- duplicates when these columns are null).

BEGIN;

ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_variant_id_key;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_user_product_variant_subvariant_mode_key
  UNIQUE NULLS NOT DISTINCT (user_id, product_id, variant_id, sub_variant_id, buy_mode);

COMMIT;
