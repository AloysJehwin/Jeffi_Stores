-- admin-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_ai_prompt_presets_tenant_kind_feature_order ON public.ai_prompt_presets USING btree (tenant_id, kind, feature, display_order);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_presets_kind_feature ON public.ai_prompt_presets USING btree (kind, feature);
-- Nullable tenant_id/feature mean a plain UNIQUE would allow dupes; COALESCE collapses NULL so the
-- (tenant, kind, feature, scenario) key is enforced even for platform rows and the "any-feature" slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_prompt_presets_scope_scenario ON public.ai_prompt_presets USING btree (
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    COALESCE(feature, ''::text),
    scenario
);
