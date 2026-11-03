-- The flagship has no tenants row any more. Drop the tenants FK of every table it writes under the
-- platform id (its rows there stay; purgeTenant now deletes a store's rows from them), then delete the
-- old "Platform (flagship)" row. Refuses if any other table still holds platform rows (its cascade would
-- delete them). Idempotent; a no-op on store databases.

BEGIN;

ALTER TABLE IF EXISTS public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_tenant_id_fkey;
ALTER TABLE IF EXISTS public.sheet_product_links DROP CONSTRAINT IF EXISTS sheet_product_links_tenant_id_fkey;
ALTER TABLE IF EXISTS public.tenant_social_accounts DROP CONSTRAINT IF EXISTS tenant_social_accounts_tenant_id_fkey;
ALTER TABLE IF EXISTS public.tenant_integration_credentials DROP CONSTRAINT IF EXISTS tenant_integration_credentials_tenant_id_fkey;
ALTER TABLE IF EXISTS public.razorpay_subscription_index DROP CONSTRAINT IF EXISTS razorpay_subscription_index_tenant_id_fkey;
ALTER TABLE IF EXISTS public.ai_provider_identities DROP CONSTRAINT IF EXISTS ai_provider_identities_tenant_id_fkey;

DO $$
DECLARE r record; n bigint;
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT c.conrelid::regclass AS tbl, a.attname AS col
             FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.contype = 'f' AND c.confrelid = 'public.tenants'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = %L::uuid', r.tbl, r.col, '00000000-0000-0000-0000-000000000000') INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% has % platform row(s); drop its tenants FK before deleting the platform tenant', r.tbl, n;
    END IF;
  END LOOP;
  DELETE FROM public.tenants WHERE id = '00000000-0000-0000-0000-000000000000';
END $$;

COMMIT;
