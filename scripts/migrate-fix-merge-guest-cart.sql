CREATE OR REPLACE FUNCTION public.merge_guest_cart_to_user(p_guest_user_id uuid, p_actual_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
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
$function$;
