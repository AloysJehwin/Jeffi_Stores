-- messaging-service: indexes. Load order comes from scripts/db-files.mjs.

-- Messaging templates library (per-tenant). See database/messaging.sql.
CREATE INDEX IF NOT EXISTS idx_family_tenant_cat ON public.template_family (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_template_tenant_channel ON public.template (tenant_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_variant_template ON public.template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_variant_approval ON public.template_variant (tenant_id, approval_status) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_version_variant ON public.template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_asset_tenant_kind ON public.template_asset (tenant_id, kind);
