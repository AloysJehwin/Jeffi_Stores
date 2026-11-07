--
-- Marketplaces (lib/marketplace): Myntra and AJIO orders, listings, stock and settlements, all keyed
-- by channel. 'amazon' is allowed so the Amazon tables can move here later; Amazon still uses its own.
--

--
-- Name: marketplace_orders; Type: TABLE; Schema: public; Owner: -
-- One row per marketplace order, linked to the orders row it created (source = channel).
-- status is the normalised MarketStatus; status_rank/event_at let stale events be ignored.
-- stock_state: none, deducted, restored, short (not enough stock), unmatched (no SKU match).
--

CREATE TABLE public.marketplace_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    external_order_id text NOT NULL,
    order_id uuid,
    status character varying(24) NOT NULL,
    raw_status text,
    status_rank smallint DEFAULT 0 NOT NULL,
    event_at timestamp with time zone,
    placed_at timestamp with time zone,
    accept_by timestamp with time zone,
    dispatch_by timestamp with time zone,
    order_total numeric(12,2),
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    ship_city text,
    ship_state text,
    ship_postal_code text,
    invoice_ref text,
    po_number text,
    po_date timestamp with time zone,
    po_amount numeric(12,2),
    stock_state character varying(16) DEFAULT 'none'::character varying NOT NULL,
    stock_note text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_order_items; Type: TABLE; Schema: public; Owner: -
-- One row per unit (unit_index 1..qty of a marketplace line), with the catalogue unit it matched.
--

CREATE TABLE public.marketplace_order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    marketplace_order_id uuid NOT NULL,
    channel character varying(16) NOT NULL,
    external_line_id text NOT NULL,
    unit_index smallint DEFAULT 1 NOT NULL,
    sku text,
    style_id text,
    title text,
    size text,
    colour text,
    unit_price numeric(12,2),
    unit_tax numeric(12,2),
    mrp numeric(12,2),
    status character varying(24),
    product_id uuid,
    variant_id uuid,
    sub_variant_id uuid,
    matched_by character varying(16),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_shipments; Type: TABLE; Schema: public; Owner: -
-- Packets the marketplace ships (RTD returns packet, tracking and courier). Tracking stays here,
-- never in orders.awb_number, which is read as a Delhivery shipment. *_key are S3 document keys.
--

CREATE TABLE public.marketplace_shipments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    marketplace_order_id uuid NOT NULL,
    order_id uuid,
    packet_id text,
    tracking_number text,
    courier text,
    tracking_url text,
    manifest_id text,
    status character varying(24),
    line_ids text[] DEFAULT '{}'::text[] NOT NULL,
    label_key text,
    invoice_key text,
    manifest_key text,
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_returns; Type: TABLE; Schema: public; Owner: -
-- Customer returns and RTOs. Stock comes back once, when the return is received and passes QC.
--

CREATE TABLE public.marketplace_returns (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    external_return_id text NOT NULL,
    marketplace_order_id uuid,
    order_id uuid,
    return_type character varying(16) DEFAULT 'customer'::character varying NOT NULL,
    status character varying(16) DEFAULT 'initiated'::character varying NOT NULL,
    reason text,
    line_ids text[] DEFAULT '{}'::text[] NOT NULL,
    refund_amount numeric(12,2),
    tracking_number text,
    restocked boolean DEFAULT false NOT NULL,
    restocked_at timestamp with time zone,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_listings; Type: TABLE; Schema: public; Owner: -
-- Which sellable unit (product, variant or sub-variant) a marketplace SKU / style is. The matcher
-- reads this first.
--

CREATE TABLE public.marketplace_listings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    sub_variant_id uuid,
    our_sku text,
    marketplace_sku text,
    style_id text,
    listing_ref text,
    category text,
    status character varying(16) DEFAULT 'unmapped'::character varying NOT NULL,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    listed_price numeric(12,2),
    listed_mrp numeric(12,2),
    last_task_id text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_listing_tasks; Type: TABLE; Schema: public; Owner: -
-- Listing submissions the marketplace processes asynchronously (polled by the sync cron).
--

CREATE TABLE public.marketplace_listing_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    task_id text NOT NULL,
    kind character varying(16) DEFAULT 'submit'::character varying NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    listing_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    result jsonb,
    error text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: marketplace_inventory_state; Type: TABLE; Schema: public; Owner: -
-- Stock per marketplace SKU and warehouse: what we have, what we last pushed, what the marketplace shows.
--

CREATE TABLE public.marketplace_inventory_state (
    channel character varying(16) NOT NULL,
    marketplace_sku text NOT NULL,
    warehouse_id text DEFAULT ''::text NOT NULL,
    listing_id uuid,
    product_id uuid,
    variant_id uuid,
    sub_variant_id uuid,
    our_available numeric(12,3),
    reserved integer DEFAULT 0 NOT NULL,
    pushed_qty integer,
    pushed_at timestamp with time zone,
    push_error text,
    marketplace_qty integer,
    checked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_webhook_events; Type: TABLE; Schema: public; Owner: -
-- Every pushed event, recorded before it is processed; event_key makes replays a no-op. Failed
-- processing stays pending with next_attempt_at backed off, then failed after the last attempt.
--

CREATE TABLE public.marketplace_webhook_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    event_key text NOT NULL,
    event_type text,
    external_order_id text,
    occurred_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source character varying(8) DEFAULT 'push'::character varying NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at timestamp with time zone,
    last_error text,
    marketplace_order_id uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: marketplace_settlements; Type: TABLE; Schema: public; Owner: -
-- One payout (settlement report or API), totals by kind.
--

CREATE TABLE public.marketplace_settlements (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    settlement_ref text NOT NULL,
    period_start date,
    period_end date,
    settled_on date,
    gross numeric(14,2) DEFAULT 0 NOT NULL,
    commission numeric(14,2) DEFAULT 0 NOT NULL,
    fees numeric(14,2) DEFAULT 0 NOT NULL,
    tax_withheld numeric(14,2) DEFAULT 0 NOT NULL,
    refunds numeric(14,2) DEFAULT 0 NOT NULL,
    adjustments numeric(14,2) DEFAULT 0 NOT NULL,
    net_amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency character varying(8) DEFAULT 'INR'::character varying NOT NULL,
    source character varying(8) DEFAULT 'upload'::character varying NOT NULL,
    file_name text,
    breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_settlement_lines; Type: TABLE; Schema: public; Owner: -
-- Settlement rows per order line (sale, refund, fee, adjustment), matched to our orders where possible.
--

CREATE TABLE public.marketplace_settlement_lines (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    settlement_id uuid NOT NULL,
    channel character varying(16) NOT NULL,
    external_order_id text,
    external_line_id text,
    marketplace_order_id uuid,
    order_id uuid,
    line_type character varying(16) DEFAULT 'sale'::character varying NOT NULL,
    description text,
    gross numeric(14,2) DEFAULT 0 NOT NULL,
    commission numeric(14,2) DEFAULT 0 NOT NULL,
    fees numeric(14,2) DEFAULT 0 NOT NULL,
    tax_withheld numeric(14,2) DEFAULT 0 NOT NULL,
    net_amount numeric(14,2) DEFAULT 0 NOT NULL,
    posted_on date,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL
);
