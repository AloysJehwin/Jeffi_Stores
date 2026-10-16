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


--
-- Name: amazon_offers; Type: TABLE; Schema: public; Owner: -
-- Buy Box and competing offers per listed SKU (Product Pricing getItemOffersBatch), refreshed hourly.
--

CREATE TABLE public.amazon_offers (
    sku text NOT NULL,
    asin text NOT NULL,
    our_price numeric(12,2),
    buybox_price numeric(12,2),
    buybox_is_ours boolean,
    buybox_fba boolean,
    lowest_price numeric(12,2),
    lowest_fba_price numeric(12,2),
    offer_count integer DEFAULT 0 NOT NULL,
    buybox_eligible boolean,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amazon_fee_estimates; Type: TABLE; Schema: public; Owner: -
-- Amazon's fee estimate per SKU at its current price (Product Fees getMyFeesEstimates). Amounts
-- are before GST; gst_on_fees is 18% of them unless Amazon returned the tax itself.
--

CREATE TABLE public.amazon_fee_estimates (
    sku text NOT NULL,
    price numeric(12,2) NOT NULL,
    referral_fee numeric(12,2) DEFAULT 0 NOT NULL,
    closing_fee numeric(12,2) DEFAULT 0 NOT NULL,
    fulfillment_fee numeric(12,2) DEFAULT 0 NOT NULL,
    other_fees numeric(12,2) DEFAULT 0 NOT NULL,
    total_fees numeric(12,2) DEFAULT 0 NOT NULL,
    gst_on_fees numeric(12,2) DEFAULT 0 NOT NULL,
    fba boolean DEFAULT false NOT NULL,
    details jsonb DEFAULT '[]'::jsonb NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amazon_repricer_rules; Type: TABLE; Schema: public; Owner: -
-- Repricer rules (lib/amazon/repricer.ts). sku NULL = the default for every listed SKU; a SKU rule
-- wins over it. strategy: match_buybox, beat_buybox (by beat_by), hold. Prices never go below the
-- floor (min_price and the margin floor from cost and fees) or above max_price.
--

CREATE TABLE public.amazon_repricer_rules (
    id bigint NOT NULL,
    sku text,
    strategy character varying(16) NOT NULL,
    beat_by numeric(10,2) DEFAULT 0 NOT NULL,
    min_price numeric(12,2),
    max_price numeric(12,2),
    min_margin_pct numeric(6,2) DEFAULT 5 NOT NULL,
    auto_apply boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.amazon_repricer_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.amazon_repricer_rules_id_seq OWNED BY public.amazon_repricer_rules.id;
ALTER TABLE ONLY public.amazon_repricer_rules ALTER COLUMN id SET DEFAULT nextval('public.amazon_repricer_rules_id_seq'::regclass);


--
-- Name: amazon_orders; Type: TABLE; Schema: public; Owner: -
-- Amazon orders imported into orders (lib/amazon/orders.ts), keyed by Amazon's id so a re-import
-- updates instead of duplicating. fulfillment_channel AFN (FBA) never moves our stock.
-- stock_state: none, deducted, restored, short (not enough stock to deduct), unmatched (no SKU match).
--

CREATE TABLE public.amazon_orders (
    amazon_order_id text NOT NULL,
    order_id uuid,
    status character varying(32) NOT NULL,
    fulfillment_channel character varying(8) NOT NULL,
    purchase_date timestamp with time zone,
    last_update_date timestamp with time zone,
    order_total numeric(12,2),
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    ship_city text,
    ship_state text,
    ship_postal_code text,
    is_prime boolean DEFAULT false NOT NULL,
    easy_ship boolean DEFAULT false NOT NULL,
    stock_state character varying(16) DEFAULT 'none'::character varying NOT NULL,
    stock_note text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amazon_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amazon_order_items (
    order_item_id text NOT NULL,
    amazon_order_id text NOT NULL,
    sku text,
    asin text,
    title text,
    quantity integer DEFAULT 0 NOT NULL,
    quantity_shipped integer DEFAULT 0 NOT NULL,
    item_price numeric(12,2),
    item_tax numeric(12,2),
    product_id uuid,
    variant_id uuid
);


--
-- Name: amazon_inventory_state; Type: TABLE; Schema: public; Owner: -
-- Merchant-fulfilled stock per listed SKU: what we have, what we last told Amazon, and what Amazon
-- shows (from the listing status refresh) for drift checks.
--

CREATE TABLE public.amazon_inventory_state (
    sku text NOT NULL,
    product_id uuid,
    variant_id uuid,
    our_available numeric(12,3),
    reserved integer DEFAULT 0 NOT NULL,
    pushed_qty integer,
    pushed_at timestamp with time zone,
    push_error text,
    amazon_quantity integer,
    amazon_checked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amazon_report_requests; Type: TABLE; Schema: public; Owner: -
-- Reports API requests in flight (they take minutes): requested by one run, collected by a later one.
--

CREATE TABLE public.amazon_report_requests (
    report_id text NOT NULL,
    report_type text NOT NULL,
    data_start date,
    data_end date,
    status character varying(16) DEFAULT 'requested'::character varying NOT NULL,
    error text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    collected_at timestamp with time zone
);


--
-- Name: amazon_sales_traffic_daily; Type: TABLE; Schema: public; Owner: -
-- Sales and traffic report by day (whole account).
--

CREATE TABLE public.amazon_sales_traffic_daily (
    date date NOT NULL,
    ordered_sales numeric(14,2) DEFAULT 0 NOT NULL,
    units_ordered integer DEFAULT 0 NOT NULL,
    order_items integer DEFAULT 0 NOT NULL,
    units_refunded integer DEFAULT 0 NOT NULL,
    sessions integer DEFAULT 0 NOT NULL,
    page_views integer DEFAULT 0 NOT NULL,
    buy_box_pct numeric(6,2),
    unit_session_pct numeric(6,2)
);


--
-- Name: amazon_sales_traffic_asin; Type: TABLE; Schema: public; Owner: -
-- Sales and traffic report by child ASIN over the report window (data_start..data_end).
--

CREATE TABLE public.amazon_sales_traffic_asin (
    asin text NOT NULL,
    sku text,
    data_start date NOT NULL,
    data_end date NOT NULL,
    ordered_sales numeric(14,2) DEFAULT 0 NOT NULL,
    units_ordered integer DEFAULT 0 NOT NULL,
    sessions integer DEFAULT 0 NOT NULL,
    page_views integer DEFAULT 0 NOT NULL,
    buy_box_pct numeric(6,2),
    unit_session_pct numeric(6,2)
);


--
-- Name: amazon_settlements; Type: TABLE; Schema: public; Owner: -
-- One row per Amazon settlement (payout): totals by kind from the V2 settlement report.
--

CREATE TABLE public.amazon_settlements (
    settlement_id text NOT NULL,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    deposit_date timestamp with time zone,
    total_amount numeric(14,2),
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    product_sales numeric(14,2) DEFAULT 0 NOT NULL,
    fees numeric(14,2) DEFAULT 0 NOT NULL,
    refunds numeric(14,2) DEFAULT 0 NOT NULL,
    tax_withheld numeric(14,2) DEFAULT 0 NOT NULL,
    other numeric(14,2) DEFAULT 0 NOT NULL,
    breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);
