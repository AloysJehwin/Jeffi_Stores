--
-- Amazon Ads (Sponsored Products) console (lib/amazon-ads): the connected profile mirrored per store.
--

CREATE TABLE public.aads_profile (
    id smallint DEFAULT 1 NOT NULL,
    profile_id text,
    name text,
    country_code character varying(4),
    currency_code character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    last_sync_at timestamp with time zone,
    last_report_at timestamp with time zone
);

CREATE TABLE public.aads_campaigns (
    campaign_id text NOT NULL,
    name text NOT NULL,
    state character varying(16) NOT NULL,
    targeting_type character varying(16),
    daily_budget numeric(12,2),
    bidding_strategy character varying(40),
    start_date date,
    end_date date,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.aads_ad_groups (
    ad_group_id text NOT NULL,
    campaign_id text NOT NULL,
    name text NOT NULL,
    state character varying(16) NOT NULL,
    default_bid numeric(10,2),
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.aads_keywords (
    keyword_id text NOT NULL,
    ad_group_id text NOT NULL,
    campaign_id text NOT NULL,
    keyword_text text NOT NULL,
    match_type character varying(16) NOT NULL,
    state character varying(16) NOT NULL,
    bid numeric(10,2),
    negative boolean DEFAULT false NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.aads_product_ads (
    ad_id text NOT NULL,
    ad_group_id text NOT NULL,
    campaign_id text NOT NULL,
    sku text,
    asin text,
    state character varying(16) NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Daily report rows. sales and orders are Amazon's 7-day attribution.
--

CREATE TABLE public.aads_daily_metrics (
    date date NOT NULL,
    campaign_id text NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    sales numeric(14,2) DEFAULT 0 NOT NULL,
    orders integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.aads_search_terms (
    date date NOT NULL,
    campaign_id text NOT NULL,
    ad_group_id text NOT NULL,
    keyword_id text DEFAULT ''::text NOT NULL,
    search_term text NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    sales numeric(14,2) DEFAULT 0 NOT NULL,
    orders integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.aads_product_metrics (
    date date NOT NULL,
    campaign_id text NOT NULL,
    ad_group_id text NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    asin text,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    sales numeric(14,2) DEFAULT 0 NOT NULL,
    orders integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.aads_report_requests (
    report_id text NOT NULL,
    report_type character varying(32) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying(16) DEFAULT 'requested'::character varying NOT NULL,
    error text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    collected_at timestamp with time zone
);
