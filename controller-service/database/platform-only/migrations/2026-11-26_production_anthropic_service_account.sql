-- Production's one Anthropic identity moves to the service account named jeffi-production (svac_01HXWF7V5MmqFNXzAaxbofaH)
-- and its Razer rule (fdrl_015c1KmN69fVRfNYSuA5pZMF), from the old jeffi-flagship account. Matches only the old
-- production rule, so local (jeffi-local) and re-runs are untouched.
DO $$
BEGIN
  IF to_regclass('public.ai_provider_identities') IS NOT NULL THEN
    UPDATE public.ai_provider_identities
       SET service_account_id = 'svac_01HXWF7V5MmqFNXzAaxbofaH',
           federation_rule_id = 'fdrl_015c1KmN69fVRfNYSuA5pZMF',
           updated_at = now()
     WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
       AND provider = 'anthropic'
       AND federation_rule_id = 'fdrl_016JTDCM9cspPwrmpERLUVHQ';
  END IF;
END $$;
