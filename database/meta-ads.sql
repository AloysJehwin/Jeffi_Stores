--
-- Meta Ads (Facebook and Instagram) console (lib/meta-ads): the connected ad account mirrored per
-- store, and the Conversions API send log.
--

CREATE TABLE public.mads_account (
    id smallint DEFAULT 1 NOT NULL,
    ad_account_id text,
    name text,
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    timezone text,
    account_status integer,
    last_sync_at timestamp with time zone
);

CREATE TABLE public.mads_campaigns (
    campaign_id text NOT NULL,
    name text NOT NULL,
    status character varying(24) NOT NULL,
    effective_status character varying(32),
    objective character varying(48),
    daily_budget numeric(14,2),
    lifetime_budget numeric(14,2),
    bid_strategy character varying(48),
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mads_adsets (
    adset_id text NOT NULL,
    campaign_id text NOT NULL,
    name text NOT NULL,
    status character varying(24) NOT NULL,
    effective_status character varying(32),
    daily_budget numeric(14,2),
    optimization_goal character varying(48),
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mads_ads (
    ad_id text NOT NULL,
    adset_id text NOT NULL,
    campaign_id text NOT NULL,
    name text NOT NULL,
    status character varying(24) NOT NULL,
    effective_status character varying(32),
    thumbnail_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Daily insights per ad (purchases and purchase value are Meta's attribution).
--

CREATE TABLE public.mads_daily_metrics (
    date date NOT NULL,
    ad_id text NOT NULL,
    adset_id text,
    campaign_id text,
    impressions bigint DEFAULT 0 NOT NULL,
    reach bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    link_clicks bigint DEFAULT 0 NOT NULL,
    spend numeric(14,2) DEFAULT 0 NOT NULL,
    purchases numeric(12,2) DEFAULT 0 NOT NULL,
    purchase_value numeric(14,2) DEFAULT 0 NOT NULL
);

--
-- Breakdowns over the last 30 days (dimension: age_gender, placement, region).
--

CREATE TABLE public.mads_breakdowns (
    dimension character varying(16) NOT NULL,
    key text NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    spend numeric(14,2) DEFAULT 0 NOT NULL,
    purchases numeric(12,2) DEFAULT 0 NOT NULL,
    purchase_value numeric(14,2) DEFAULT 0 NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Conversions API: one Purchase per paid order (event_id = order id, so Meta dedupes it against a
-- browser pixel event with the same id). status: sent, failed, skipped (no consent).
--

CREATE TABLE public.mads_capi_events (
    order_id uuid NOT NULL,
    event_name character varying(24) DEFAULT 'Purchase'::character varying NOT NULL,
    value numeric(14,2) NOT NULL,
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    status character varying(16) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    matched_keys text[] DEFAULT '{}'::text[] NOT NULL,
    error text,
    fbtrace_id text,
    event_time timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
