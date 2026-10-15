-- Bulk jobs for the public Documents / Messaging APIs. Items are claimed by each service's worker
-- (FOR UPDATE SKIP LOCKED). Applied by the schema pipeline. LOCAL ONLY (never RDS).

CREATE TABLE IF NOT EXISTS public.bulk_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    api_key_id uuid,
    kind character varying(16) NOT NULL,
    status character varying(16) NOT NULL DEFAULT 'queued',
    total integer NOT NULL DEFAULT 0,
    succeeded integer NOT NULL DEFAULT 0,
    failed integer NOT NULL DEFAULT 0,
    skipped integer NOT NULL DEFAULT 0,
    spent_inr numeric(12,4) NOT NULL DEFAULT 0,
    options jsonb NOT NULL DEFAULT '{}'::jsonb,
    reference character varying(120),
    error text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    started_at timestamp with time zone,
    finished_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.bulk_job_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    job_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    seq integer NOT NULL,
    status character varying(16) NOT NULL DEFAULT 'pending',
    input jsonb NOT NULL,
    result_id uuid,
    result jsonb,
    error text,
    attempts integer NOT NULL DEFAULT 0,
    locked_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
