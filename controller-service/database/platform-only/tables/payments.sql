-- controller-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

-- Jeffi's own tax invoices to tenants (plan subscription charges, wallet top-ups). One per Razorpay
-- payment (kind + external_ref), so the browser verify, admin verify and webhook paths issue it once.
CREATE TABLE IF NOT EXISTS public.platform_invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    external_ref character varying(64) NOT NULL,
    number character varying(40),
    document_id uuid,
    view_url text,
    taxable_inr numeric(12,2) NOT NULL DEFAULT 0,
    gst_inr numeric(12,2) NOT NULL DEFAULT 0,
    total_inr numeric(12,2) NOT NULL DEFAULT 0,
    emailed_to character varying(255),
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
