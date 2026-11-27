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
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_skills_slug ON public.outreach_skills (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
CREATE INDEX IF NOT EXISTS idx_outreach_skill_versions_skill ON public.outreach_skill_versions (skill_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_agent_runs_open ON public.outreach_agent_runs (contact_id) WHERE status IN ('active', 'handed_off');
CREATE INDEX IF NOT EXISTS idx_outreach_agent_runs_contact ON public.outreach_agent_runs (contact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_agent_tasks_due ON public.outreach_agent_tasks (status, due_at);
CREATE INDEX IF NOT EXISTS idx_outreach_agent_tasks_contact ON public.outreach_agent_tasks (contact_id);
