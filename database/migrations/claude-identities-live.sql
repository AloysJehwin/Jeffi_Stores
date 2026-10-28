-- Claude workload identities for the live stores (Anthropic Console, issuer jeffi-razer-k3s, subject
-- system:serviceaccount:ai-platform:ai-gateway): the flagship and testco. Insert-only, so a store that
-- already has one (a dev machine's jeffi-local identity) keeps it. Tenant DBs have no such table.
DO $$
BEGIN
  IF to_regclass('public.ai_provider_identities') IS NULL THEN RETURN; END IF;
  INSERT INTO public.ai_provider_identities (tenant_id, provider, workspace_id, service_account_id, federation_rule_id)
  VALUES ('00000000-0000-0000-0000-000000000000', 'anthropic',
          'wrkspc_015htan8z4DDLDEQiUYJC6ci', 'svac_01Y2V3xrZqMpGFaCaNssTvFT', 'fdrl_016JTDCM9cspPwrmpERLUVHQ')
  ON CONFLICT (tenant_id, provider) DO NOTHING;
  INSERT INTO public.ai_provider_identities (tenant_id, provider, workspace_id, service_account_id, federation_rule_id)
  SELECT id, 'anthropic', 'wrkspc_01JBG6CVFi8z2EGJ8pa6Wt8F', 'svac_019V9W4bv3LVwwb6g6FomGAt', 'fdrl_012PVLLZeyy5QJ3N1SfD5gFW'
    FROM public.tenants WHERE slug = 'testco'
  ON CONFLICT (tenant_id, provider) DO NOTHING;
END $$;
