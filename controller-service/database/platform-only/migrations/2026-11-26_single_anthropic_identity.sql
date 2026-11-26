-- One Anthropic workload identity per environment (jeffi-production / jeffi-local): every store uses the platform
-- row, and getAnthropicIdentity no longer reads per-store rows. Drop them. Safe to run twice.
DO $$
BEGIN
  IF to_regclass('public.ai_provider_identities') IS NOT NULL THEN
    DELETE FROM public.ai_provider_identities WHERE tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
END $$;
