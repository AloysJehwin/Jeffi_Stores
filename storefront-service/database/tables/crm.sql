-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: customer_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid,
    kind character varying(64) NOT NULL,
    reference_id uuid,
    reference_type character varying(64),
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_notes; Type: TABLE; Schema: public; Owner: -
--

-- customer_notes gained source / title / tags / shared_with_customer / return_request_id on
-- 2026-09-24. Existing tenants receive them through the fan-out's per-table column
-- reconciliation (src/lib/tenant-migrations-schema.ts), which must run before the CHECK on
-- source and the partial index on shared_with_customer below.
CREATE TABLE public.customer_notes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_id uuid,
    title character varying(200),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    order_id uuid,
    return_request_id uuid,
    shared_with_customer boolean DEFAULT false NOT NULL,
    source character varying(20) DEFAULT 'admin_panel'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_note_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_note_attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    note_id uuid NOT NULL,
    kind character varying(10) DEFAULT 'image'::character varying NOT NULL,
    s3_key character varying(500) NOT NULL,
    s3_thumbnail_key character varying(500),
    mime_type character varying(100) NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    width integer,
    height integer,
    duration_seconds integer,
    original_name character varying(255),
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
