-- controller-service: platform-only indexes (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON public.platform_invoices (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_service_approvals_pending ON public.tenant_service_approvals (status, requested_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_due ON public.outreach_contacts (program, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_phone ON public.outreach_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_list ON public.outreach_contacts (list_id);
CREATE INDEX IF NOT EXISTS idx_outreach_calls_contact ON public.outreach_calls (contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_calls_provider ON public.outreach_calls (provider_call_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_contact ON public.outreach_events (contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_created ON public.outreach_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_contact ON public.outreach_messages (contact_id);
