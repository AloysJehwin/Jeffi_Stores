-- controller-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON public.platform_invoices (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_service_approvals_pending ON public.tenant_service_approvals (status, requested_at) WHERE status = 'pending';
