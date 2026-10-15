-- Google Ads reporting schema (read-only mirror of the connected Ads account, filled by
-- lib/google-ads/sync.ts). Ids are Google's int64 ids; money is micros of the account currency.
-- Schema-only, no owner, no acl. Applied by the schema pipeline.


--
-- Name: ads_account; Type: TABLE; Schema: public; Owner: -
-- Singleton (id = 1): the connected customer and its health fields.
--

CREATE TABLE public.ads_account (
    id smallint DEFAULT 1 NOT NULL,
    customer_id bigint NOT NULL,
    descriptive_name text,
    currency_code character varying(8),
    time_zone character varying(64),
    manager_id bigint,
    test_account boolean DEFAULT false NOT NULL,
    status character varying(32),
    optimization_score numeric(6,4),
    budget_status character varying(32),
    budget_limit_micros bigint,
    budget_served_micros bigint,
    budget_end text,
    last_sync_at timestamp with time zone,
    last_full_sync_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_campaigns (
    campaign_id bigint NOT NULL,
    name text NOT NULL,
    status character varying(32),
    serving_status character varying(32),
    primary_status character varying(48),
    channel_type character varying(48),
    channel_sub_type character varying(64),
    bidding_strategy_type character varying(64),
    budget_amount_micros bigint,
    budget_period character varying(32),
    start_date date,
    end_date date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_ad_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_ad_groups (
    ad_group_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    name text NOT NULL,
    status character varying(32),
    type character varying(48),
    cpc_bid_micros bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_ads; Type: TABLE; Schema: public; Owner: -
-- Ads with policy status; metrics are a snapshot over the last full sync window.
--

CREATE TABLE public.ads_ads (
    ad_group_id bigint NOT NULL,
    ad_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    name text,
    type character varying(48),
    status character varying(32),
    approval_status character varying(48),
    review_status character varying(48),
    policy_topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    final_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    headlines jsonb DEFAULT '[]'::jsonb NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_keywords; Type: TABLE; Schema: public; Owner: -
-- Keywords; metrics are a snapshot over the last full sync window.
--

CREATE TABLE public.ads_keywords (
    ad_group_id bigint NOT NULL,
    criterion_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    text text NOT NULL,
    match_type character varying(16),
    status character varying(32),
    negative boolean DEFAULT false NOT NULL,
    quality_score smallint,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    conversions_value numeric(16,4) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_daily_metrics; Type: TABLE; Schema: public; Owner: -
-- Daily metrics by campaign x device x network. ad_group_id = 0 is the campaign total (covers
-- campaigns without ad groups, e.g. Performance Max); ad_group_id > 0 rows are per ad group.
--

CREATE TABLE public.ads_daily_metrics (
    date date NOT NULL,
    campaign_id bigint NOT NULL,
    ad_group_id bigint DEFAULT 0 NOT NULL,
    device character varying(24) NOT NULL,
    network character varying(32) NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    conversions_value numeric(16,4) DEFAULT 0 NOT NULL,
    all_conversions numeric(14,4) DEFAULT 0 NOT NULL
);


--
-- Name: ads_product_metrics; Type: TABLE; Schema: public; Owner: -
-- Shopping item metrics. item_id is Google's lower-cased offer id (our SKU, see merchant/mapper).
--

CREATE TABLE public.ads_product_metrics (
    date date NOT NULL,
    item_id text NOT NULL,
    campaign_id bigint NOT NULL,
    product_title text,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    conversions_value numeric(16,4) DEFAULT 0 NOT NULL,
    all_conversions numeric(14,4) DEFAULT 0 NOT NULL
);


--
-- Name: ads_search_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_search_terms (
    date date NOT NULL,
    campaign_id bigint NOT NULL,
    ad_group_id bigint DEFAULT 0 NOT NULL,
    search_term text NOT NULL,
    status character varying(24),
    keyword_text text,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    conversions_value numeric(16,4) DEFAULT 0 NOT NULL,
    all_conversions numeric(14,4) DEFAULT 0 NOT NULL
);


--
-- Name: ads_geo_metrics; Type: TABLE; Schema: public; Owner: -
-- Where clickers physically were (user_location_view), by region; location is a geoTargetConstants/ resource.
--

CREATE TABLE public.ads_geo_metrics (
    date date NOT NULL,
    location text NOT NULL,
    country_criterion_id bigint,
    location_name text,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,4) DEFAULT 0 NOT NULL,
    conversions_value numeric(16,4) DEFAULT 0 NOT NULL,
    all_conversions numeric(14,4) DEFAULT 0 NOT NULL
);


--
-- Name: ads_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_recommendations (
    resource_name text NOT NULL,
    type character varying(64),
    campaign_id bigint,
    impact jsonb,
    dismissed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ads_change_events; Type: TABLE; Schema: public; Owner: -
-- change_date_time is in the account time zone, as Google reports it.
--

CREATE TABLE public.ads_change_events (
    resource_name text NOT NULL,
    change_date_time timestamp without time zone,
    resource_type character varying(48),
    changed_resource text,
    operation character varying(16),
    client_type character varying(48),
    user_email text,
    campaign_id bigint,
    changed_fields text
);


--
-- Name: ads_sync_log; Type: TABLE; Schema: public; Owner: -
-- One row per sync run (full = last 30 days, today = intraday refresh).
--

CREATE TABLE public.ads_sync_log (
    id integer NOT NULL,
    mode character varying(16) NOT NULL,
    status character varying(20) NOT NULL,
    date_from date,
    date_to date,
    rows jsonb DEFAULT '{}'::jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: ads_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ads_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ads_sync_log_id_seq OWNED BY public.ads_sync_log.id;
ALTER TABLE ONLY public.ads_sync_log ALTER COLUMN id SET DEFAULT nextval('public.ads_sync_log_id_seq'::regclass);
