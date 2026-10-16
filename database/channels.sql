--
-- Shared tables for the sales-channel consoles (lib/channels): Google Merchant, Amazon Seller,
-- Amazon Ads, Meta Ads and social. Google Ads keeps its own ads_* tables.
-- channel: gmc, amazon, amazon_ads, meta_ads, social.
--

--
-- Name: channel_sync_log; Type: TABLE; Schema: public; Owner: -
-- One row per job run (kind: e.g. status, reports, pricing, orders), with row counts and errors.
--

CREATE TABLE public.channel_sync_log (
    id bigint NOT NULL,
    channel character varying(16) NOT NULL,
    kind character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);

CREATE SEQUENCE public.channel_sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.channel_sync_log_id_seq OWNED BY public.channel_sync_log.id;
ALTER TABLE ONLY public.channel_sync_log ALTER COLUMN id SET DEFAULT nextval('public.channel_sync_log_id_seq'::regclass);


--
-- Name: channel_alerts; Type: TABLE; Schema: public; Owner: -
-- One open alert per (channel, dedupe_key) until the condition clears (lib/channels/alerts-engine.ts).
--

CREATE TABLE public.channel_alerts (
    id bigint NOT NULL,
    channel character varying(16) NOT NULL,
    rule character varying(40) NOT NULL,
    dedupe_key text NOT NULL,
    severity character varying(12) NOT NULL,
    title text NOT NULL,
    message text,
    entity_type character varying(32),
    entity_id text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    notified_at timestamp with time zone,
    resolved_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    dismissed_by text
);

CREATE SEQUENCE public.channel_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.channel_alerts_id_seq OWNED BY public.channel_alerts.id;
ALTER TABLE ONLY public.channel_alerts ALTER COLUMN id SET DEFAULT nextval('public.channel_alerts_id_seq'::regclass);


--
-- Name: channel_change_log; Type: TABLE; Schema: public; Owner: -
-- Changes made from a channel console: one row per attempt. status: applied, rejected (failed
-- validation, nothing sent) or failed (the channel refused the change).
--

CREATE TABLE public.channel_change_log (
    id bigint NOT NULL,
    channel character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_id uuid,
    admin_email text,
    action character varying(48) NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id text,
    summary text NOT NULL,
    before jsonb,
    after jsonb,
    status character varying(16) NOT NULL,
    error text
);

CREATE SEQUENCE public.channel_change_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.channel_change_log_id_seq OWNED BY public.channel_change_log.id;
ALTER TABLE ONLY public.channel_change_log ALTER COLUMN id SET DEFAULT nextval('public.channel_change_log_id_seq'::regclass);
