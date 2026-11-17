-- showcase-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_showcase_sites_owner ON public.showcase_sites (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_sites_tenant ON public.showcase_sites (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_showcase_sites_custom_domain ON public.showcase_sites (custom_domain) WHERE custom_domain IS NOT NULL;
-- The showcase_renew cron's daily scan.
CREATE INDEX IF NOT EXISTS idx_showcase_sites_billing ON public.showcase_sites (paid_until) WHERE status <> 'draft';

CREATE INDEX IF NOT EXISTS idx_showcase_leads_site ON public.showcase_leads (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_leads_unread ON public.showcase_leads (site_id) WHERE read_at IS NULL;
