-- Public Documents API (document-service): rendered documents, numbering sequences and per-workspace design settings.
-- Applied by the schema pipeline. LOCAL ONLY (never RDS).

CREATE TABLE IF NOT EXISTS public.documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    api_key_id uuid,
    type character varying(24) NOT NULL,
    number character varying(40) NOT NULL,
    template character varying(40) NOT NULL DEFAULT 'aurora',
    payload jsonb NOT NULL,
    totals jsonb NOT NULL,
    s3_key text NOT NULL,
    view_token character varying(48) NOT NULL,
    price_inr numeric(10,4) NOT NULL DEFAULT 0,
    reference character varying(120),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_sequences (
    tenant_id uuid NOT NULL,
    type character varying(24) NOT NULL,
    financial_year character varying(8) NOT NULL,
    next_seq integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.document_settings (
    tenant_id uuid NOT NULL,
    design character varying(40),
    accent character varying(9),
    font character varying(24),
    logo_key text,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
