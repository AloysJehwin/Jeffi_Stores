-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: _debug_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._debug_log (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    source text,
    payload text
);


--
-- Name: _debug_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._debug_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public._debug_log_id_seq OWNED BY public._debug_log.id;
ALTER TABLE ONLY public._debug_log ALTER COLUMN id SET DEFAULT nextval('public._debug_log_id_seq'::regclass);


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    summary text NOT NULL,
    diff jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    email character varying(255) NOT NULL,
    subject character varying(255),
    template_name character varying(100),
    status character varying(50) DEFAULT 'sent'::character varying,
    sent_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    from_email character varying(255),
    cc text,
    bcc text,
    body_html text,
    body_text text,
    kind character varying(64),
    entity_type character varying(64),
    entity_id character varying(128),
    error text,
    message_id character varying(255)
);


--
-- Name: merchant_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_sync_log (
    id integer NOT NULL,
    status character varying(20) NOT NULL,
    synced integer DEFAULT 0 NOT NULL,
    deleted integer DEFAULT 0 NOT NULL,
    errors jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: merchant_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.merchant_sync_log_id_seq OWNED BY public.merchant_sync_log.id;
ALTER TABLE ONLY public.merchant_sync_log ALTER COLUMN id SET DEFAULT nextval('public.merchant_sync_log_id_seq'::regclass);


--
-- Name: page_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(64) NOT NULL,
    user_id uuid,
    page character varying(32) NOT NULL,
    path text NOT NULL,
    referrer text,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_inflation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_inflation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    category_name character varying(100) NOT NULL,
    percentage numeric(5,2) NOT NULL,
    applied_fields text[] NOT NULL,
    product_count integer DEFAULT 0 NOT NULL,
    applied_by character varying(100),
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot jsonb,
    is_rollback boolean DEFAULT false NOT NULL,
    rolled_back_at timestamp with time zone,
    rolled_back_by character varying(100)
);


--
-- Name: replication_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.replication_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id text NOT NULL,
    source text DEFAULT 'razer'::text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone,
    duration_seconds integer,
    row_count bigint,
    dump_bytes bigint,
    message text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT replication_runs_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text, 'partial'::text, 'started'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: search_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    query text NOT NULL,
    results_count integer DEFAULT 0 NOT NULL,
    user_id uuid,
    session_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: search_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_queries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    query character varying(255) NOT NULL,
    results_count integer,
    clicked_product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_search_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_search_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    query character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: websocket_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.websocket_connections (
    connection_id character varying(200) NOT NULL,
    user_id uuid,
    session_id uuid,
    role character varying(10) NOT NULL,
    connected_at timestamp with time zone DEFAULT now()
);
