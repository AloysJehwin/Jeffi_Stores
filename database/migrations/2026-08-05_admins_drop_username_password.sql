-- Remove admins.username and admins.password_hash.
-- Admin login is Google OAuth + email-OTP + TOTP; password login is gone and
-- username no longer identifies certs/accounts (cert identity is now email, matched
-- via admin_certificates.common_name). Application code that read/wrote these
-- columns has already been deployed WITHOUT them.
--
-- Idempotent + transactional. Order: repoint the audit-label function off
-- admins.username FIRST (else admin audit labels silently become NULL), then drop
-- the unique constraint, then the columns.

BEGIN;

-- 1) Repoint audit_label_for's admin branch to the linked users row (name/email)
--    instead of admins.username. All other branches are unchanged. The admin
--    branch now does its own JOIN, so it can't use the generic dynamic lookup.
CREATE OR REPLACE FUNCTION public.audit_label_for(col_name text, val_text text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
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

  -- Admin actor columns: resolve display name via the linked users row.
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
$function$;

-- 2) Drop the UNIQUE constraint on username explicitly (else it cascade-drops).
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_username_key;

-- 3) Drop the columns (DROP COLUMN removes the NOT NULL with the column).
ALTER TABLE public.admins DROP COLUMN IF EXISTS username;
ALTER TABLE public.admins DROP COLUMN IF EXISTS password_hash;

COMMIT;
