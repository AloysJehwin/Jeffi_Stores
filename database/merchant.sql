--
-- Google Merchant Center console (lib/merchant/reports.ts): Merchant API reports and account state
-- mirrored per store. Sync runs live in merchant_sync_log / merchant_gmc_status (logs.sql).
--

--
-- Name: gmc_product_performance; Type: TABLE; Schema: public; Owner: -
-- product_performance_view per day, offer and marketing method (ORGANIC = free listings, ADS).
--

CREATE TABLE public.gmc_product_performance (
    date date NOT NULL,
    offer_id text NOT NULL,
    marketing_method character varying(16) NOT NULL,
    title text,
    clicks bigint DEFAULT 0 NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    conversions numeric(14,2) DEFAULT 0 NOT NULL,
    conversion_value numeric(14,2) DEFAULT 0 NOT NULL
);


--
-- Name: gmc_price_competitiveness; Type: TABLE; Schema: public; Owner: -
-- Our price against Google's benchmark (what other merchants charge for the same product).
--

CREATE TABLE public.gmc_price_competitiveness (
    offer_id text NOT NULL,
    title text,
    brand text,
    price numeric(12,2),
    benchmark_price numeric(12,2),
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gmc_price_insights; Type: TABLE; Schema: public; Owner: -
-- Google's suggested price and the predicted change in impressions, clicks and conversions.
--

CREATE TABLE public.gmc_price_insights (
    offer_id text NOT NULL,
    title text,
    brand text,
    price numeric(12,2),
    suggested_price numeric(12,2),
    predicted_impressions_change numeric(8,4),
    predicted_clicks_change numeric(8,4),
    predicted_conversions_change numeric(8,4),
    effectiveness character varying(16),
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gmc_best_sellers; Type: TABLE; Schema: public; Owner: -
-- best_sellers_product_cluster_view for India (weekly), matched to our catalogue by GTIN, then
-- brand + title. catalog_status: in_stock, out_of_stock, not_listed (we carry it, Google does not
-- show it for us), not_carried.
--

CREATE TABLE public.gmc_best_sellers (
    report_date date NOT NULL,
    category_id text NOT NULL,
    rank integer NOT NULL,
    previous_rank integer,
    title text,
    brand text,
    category_l1 text,
    category_l2 text,
    category_l3 text,
    relative_demand character varying(16),
    inventory_status character varying(24),
    brand_inventory_status character varying(24),
    gtins text[] DEFAULT '{}'::text[] NOT NULL,
    product_id uuid,
    catalog_status character varying(16) DEFAULT 'not_carried'::character varying NOT NULL
);


--
-- Name: gmc_account_issues; Type: TABLE; Schema: public; Owner: -
-- Account-level issues (accounts.issues), replaced on every refresh.
--

CREATE TABLE public.gmc_account_issues (
    name text NOT NULL,
    title text NOT NULL,
    severity character varying(16) NOT NULL,
    detail text,
    documentation_uri text,
    destinations jsonb DEFAULT '[]'::jsonb NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gmc_issue_cache; Type: TABLE; Schema: public; Owner: -
-- Google's rendered explanation and fix actions for one product's issues (issueresolution API).
--

CREATE TABLE public.gmc_issue_cache (
    offer_id text NOT NULL,
    rendered jsonb DEFAULT '[]'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gmc_account_state; Type: TABLE; Schema: public; Owner: -
-- Single row: programs (free listings, shopping ads, promotions), shipping settings and return
-- policies as Google returned them, refreshed with the reports.
--

CREATE TABLE public.gmc_account_state (
    id smallint DEFAULT 1 NOT NULL,
    programs jsonb DEFAULT '[]'::jsonb NOT NULL,
    shipping jsonb,
    return_policies jsonb DEFAULT '[]'::jsonb NOT NULL,
    promotions jsonb DEFAULT '[]'::jsonb NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);
