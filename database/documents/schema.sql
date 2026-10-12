--
-- document-service — owned tables (database: jeffi_documents).
--
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.documents (
    id           uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id    uuid NOT NULL,
    api_key_id   uuid,
    type         character varying(24) NOT NULL,   -- invoice|quotation|receipt|packing_slip|label|purchase_order
    number       character varying(40) NOT NULL,
    template     character varying(40) NOT NULL DEFAULT 'classic',
    payload      jsonb NOT NULL,                   -- the validated RenderDocumentRequest
    totals       jsonb NOT NULL,
    s3_key       text NOT NULL,
    view_token   character varying(48) NOT NULL,
    price_inr    numeric(10,4) NOT NULL DEFAULT 0,
    reference    character varying(120),
    created_at   timestamp with time zone NOT NULL DEFAULT now()
);

-- Per tenant+type sequence used when the caller does not supply a number. Numbers are PREFIX/FY/NNN.
CREATE TABLE IF NOT EXISTS public.document_sequences (
    tenant_id       uuid NOT NULL,
    type            character varying(24) NOT NULL,
    financial_year  character varying(8) NOT NULL,
    next_seq        integer NOT NULL DEFAULT 1
);

ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_view_token_key UNIQUE (view_token);
ALTER TABLE ONLY public.documents ADD CONSTRAINT documents_type_check CHECK (type IN ('invoice','quotation','receipt','packing_slip','label','purchase_order'));
CREATE INDEX IF NOT EXISTS idx_documents_tenant_created ON public.documents (tenant_id, created_at DESC);
ALTER TABLE ONLY public.document_sequences ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (tenant_id, type, financial_year);
