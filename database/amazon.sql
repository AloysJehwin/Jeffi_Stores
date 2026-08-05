-- Amazon SP-API integration schema.
-- Mirrors the Google Merchant trio in database/logs.sql (merchant_sync_log,
-- merchant_gmc_status, merchant_gmc_refresh_meta). Schema-only, no owner, no acl.
-- Applied by the schema pipeline.


--
-- Name: amazon_sync_log; Type: TABLE; Schema: public; Owner: -
-- One row per full/single catalog push to Amazon (analog of merchant_sync_log).
--

CREATE TABLE public.amazon_sync_log (
    id integer NOT NULL,
    status character varying(20) NOT NULL,
    synced integer DEFAULT 0 NOT NULL,
    deleted integer DEFAULT 0 NOT NULL,
    errors jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: amazon_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.amazon_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.amazon_sync_log_id_seq OWNED BY public.amazon_sync_log.id;
ALTER TABLE ONLY public.amazon_sync_log ALTER COLUMN id SET DEFAULT nextval('public.amazon_sync_log_id_seq'::regclass);


--
-- Name: amazon_listing_status; Type: TABLE; Schema: public; Owner: -
-- Cached snapshot of our own Amazon listing statuses (Listings Items API), so the Amazon
-- tab can paginate/search without paging SP-API live. Refreshed on demand via
-- POST /api/admin/merchant/amazon/listing-status/refresh.
--

CREATE TABLE public.amazon_listing_status (
    sku text NOT NULL,
    title text,
    status text,
    parent_sku text,
    asin text,
    price text,
    summaries jsonb DEFAULT '[]'::jsonb NOT NULL,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amazon_refresh_meta; Type: TABLE; Schema: public; Owner: -
-- Single-row meta tracking the last full Amazon status refresh and aggregate counts.
--

CREATE TABLE public.amazon_refresh_meta (
    id integer DEFAULT 1 NOT NULL,
    last_refreshed_at timestamp with time zone,
    total integer DEFAULT 0 NOT NULL,
    approved integer DEFAULT 0 NOT NULL,
    pending integer DEFAULT 0 NOT NULL,
    disapproved integer DEFAULT 0 NOT NULL
);
