-- messaging-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_short_link_tenant ON public.short_link (tenant_id, created_at DESC);

-- Platform catalog + public-API customer copies. See database/messaging.sql.
CREATE INDEX IF NOT EXISTS idx_platform_family_cat ON public.platform_template_family (category);
CREATE INDEX IF NOT EXISTS idx_platform_template_channel ON public.platform_template (channel, status);
CREATE INDEX IF NOT EXISTS idx_platform_version_variant ON public.platform_template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pub_family_user_cat ON public.pub_template_family (public_user_id, category);
CREATE INDEX IF NOT EXISTS idx_pub_template_user_channel ON public.pub_template (public_user_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_pub_variant_template ON public.pub_template_variant (template_id);
CREATE INDEX IF NOT EXISTS idx_pub_version_variant ON public.pub_template_version (variant_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pub_asset_user_kind ON public.pub_template_asset (public_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_pub_short_link_user ON public.pub_short_link (public_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON public.messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_provider_ref ON public.messages (provider_ref);
CREATE INDEX IF NOT EXISTS idx_messages_batch ON public.messages (batch_id);
CREATE INDEX IF NOT EXISTS idx_message_events_message ON public.message_events (message_id);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_tenant_kind ON public.bulk_jobs (tenant_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_items_claim ON public.bulk_job_items (status, job_id, seq);
CREATE INDEX IF NOT EXISTS idx_bulk_items_job ON public.bulk_job_items (job_id, seq);
