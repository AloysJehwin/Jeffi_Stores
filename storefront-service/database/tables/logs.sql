-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

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
    created_at timestamp with time zone DEFAULT now(),
    utm_source text,
    utm_medium text,
    utm_campaign text,
    gclid text,
    gbraid text,
    wbraid text
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
-- Name: user_search_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_search_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    query character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vault_access_log; Type: TABLE; Schema: public; Owner: -
--
-- One row per vault stream/download URL mint. action = 'stream' | 'download'. bytes is an
-- approximation (file size at mint time) for later bandwidth billing. bigint id via sequence —
-- the add-only tenant pipeline cannot introduce GENERATED-AS-IDENTITY, so follow _debug_log.

CREATE TABLE public.vault_access_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid,
    product_file_id uuid,
    entitlement_id uuid,
    action character varying(10) NOT NULL,
    bytes bigint DEFAULT 0 NOT NULL,
    ip_net character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vault_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vault_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vault_access_log_id_seq OWNED BY public.vault_access_log.id;
ALTER TABLE ONLY public.vault_access_log ALTER COLUMN id SET DEFAULT nextval('public.vault_access_log_id_seq'::regclass);
