-- Admin approval per service for Messaging/Documents ("API") workspaces. A service is usable through
-- the API only while its row is 'approved'. Applied by the schema pipeline. LOCAL ONLY (never RDS).

CREATE TABLE IF NOT EXISTS public.tenant_service_approvals (
    tenant_id uuid NOT NULL,
    service character varying(16) NOT NULL,
    status character varying(16) NOT NULL DEFAULT 'pending',
    requested_at timestamp with time zone NOT NULL DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by character varying(200),
    note text
);
