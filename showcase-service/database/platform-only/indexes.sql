-- showcase-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_showcase_sites_owner ON public.showcase_sites (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_sites_tenant ON public.showcase_sites (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_showcase_sites_custom_domain ON public.showcase_sites (custom_domain) WHERE custom_domain IS NOT NULL;
-- The billing sweep's daily scans.
CREATE INDEX IF NOT EXISTS idx_showcase_sites_billing ON public.showcase_sites (paid_until) WHERE status <> 'draft';
CREATE INDEX IF NOT EXISTS idx_showcase_sites_trial ON public.showcase_sites (trial_ends_at) WHERE trial_ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_showcase_leads_site ON public.showcase_leads (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_leads_unread ON public.showcase_leads (site_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_showcase_leads_session ON public.showcase_leads (site_id, session_id) WHERE session_id IS NOT NULL;

-- The analytics page's period scans, Real-time's last 30 minutes, and the new-visitor and enquiry-to-visit lookups.
CREATE INDEX IF NOT EXISTS idx_showcase_sessions_started ON public.showcase_sessions (site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_sessions_seen ON public.showcase_sessions (site_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_sessions_visitor ON public.showcase_sessions (site_id, visitor_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_events_created ON public.showcase_events (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_events_session ON public.showcase_events (site_id, session_id);

-- A site's live preview links (shortened at publish, revoked together).
CREATE INDEX IF NOT EXISTS idx_showcase_preview_tokens_site ON public.showcase_preview_tokens (site_id, expires_at) WHERE revoked_at IS NULL;
