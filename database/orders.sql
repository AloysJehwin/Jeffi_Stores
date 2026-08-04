-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: back_in_stock_notify; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.back_in_stock_notify (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    email text NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notified_at timestamp with time zone
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    variant_id uuid,
    quantity numeric(10,3) DEFAULT 1 NOT NULL,
    price_at_addition numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    buy_mode character varying(10) DEFAULT 'unit'::character varying NOT NULL,
    buy_unit character varying(10),
    sub_variant_id uuid,
    saved_for_later boolean DEFAULT false NOT NULL,
    saved_at timestamp with time zone
);


--
-- Name: delhivery_pickup_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delhivery_pickup_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_id character varying(128),
    pickup_date date NOT NULL,
    awb_count integer NOT NULL,
    awbs text[] NOT NULL,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pickup_status character varying(32) DEFAULT 'pending'::character varying NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    product_id uuid,
    variant_id uuid,
    product_name character varying(255) NOT NULL,
    product_sku character varying(100),
    variant_name character varying(255),
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total_price numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hsn_code character varying(20),
    gst_rate numeric(5,2),
    taxable_amount numeric(12,2) DEFAULT 0,
    cgst_amount numeric(12,2) DEFAULT 0,
    sgst_amount numeric(12,2) DEFAULT 0,
    igst_amount numeric(12,2) DEFAULT 0,
    buy_mode character varying(10) DEFAULT 'unit'::character varying NOT NULL,
    buy_unit character varying(10),
    sub_variant_id uuid,
    sold_unit character varying(20),
    sold_unit_factor numeric(14,6),
    base_quantity numeric(14,4),
    applied_rules jsonb,
    mrp numeric(12,2) DEFAULT NULL::numeric,
    batch_id uuid,
    discount_pct numeric DEFAULT 0 NOT NULL
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    status character varying(50) NOT NULL,
    comment text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_number character varying(50) NOT NULL,
    user_id uuid,
    customer_email character varying(255),
    customer_phone character varying(20),
    customer_name character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'unpaid'::character varying,
    subtotal numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    shipping_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) NOT NULL,
    shipping_address_id uuid,
    billing_address_id uuid,
    shipping_method character varying(100),
    tracking_number character varying(255),
    notes text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    invoice_number character varying(50),
    invoice_date timestamp with time zone,
    taxable_amount numeric(12,2) DEFAULT 0,
    cgst_amount numeric(12,2) DEFAULT 0,
    sgst_amount numeric(12,2) DEFAULT 0,
    igst_amount numeric(12,2) DEFAULT 0,
    is_igst boolean DEFAULT false,
    buyer_gstin character varying(20),
    cancellation_note text,
    tracking_url text,
    original_order_id uuid,
    awb_number character varying(64),
    delhivery_shipment_id character varying(128),
    irn character varying(64),
    irn_ack_no character varying(32),
    irn_ack_dt timestamp with time zone,
    signed_qr text,
    irn_status character varying(20) DEFAULT 'pending'::character varying,
    irn_cancelled_at timestamp with time zone,
    eway_bill_no character varying(20),
    eway_bill_date timestamp with time zone,
    eway_bill_valid_upto timestamp with time zone,
    payment_link_id character varying(64),
    payment_link_url text,
    payment_link_status character varying(20),
    payment_link_expires_at timestamp with time zone,
    source character varying(20) DEFAULT 'online'::character varying NOT NULL,
    search_vector tsvector,
    order_type character varying(10) DEFAULT 'cart'::character varying NOT NULL,
    view_token uuid DEFAULT gen_random_uuid(),
    shipping_address_snapshot jsonb,
    billing_address_snapshot jsonb,
    payment_mode character varying(50) DEFAULT 'cash'::character varying NOT NULL,
    razorpay_qr_id text,
    razorpay_qr_image_url text,
    needs_delivery boolean DEFAULT false NOT NULL,
    business_discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    shipment_status text,
    estimated_delivery_date date,
    cod_remitted_at timestamp with time zone,
    draft_of_id uuid,
    CONSTRAINT orders_shipment_status_check CHECK (((shipment_status IS NULL) OR (shipment_status = ANY (ARRAY['created'::text, 'picked_up'::text, 'in_transit'::text, 'out_for_delivery'::text, 'delivery_attempted'::text, 'delivered'::text, 'rto_initiated'::text, 'rto_in_transit'::text, 'rto_out_for_return'::text, 'rto_delivered'::text]))))
);

COMMENT ON COLUMN public.orders.shipment_status IS 'Stable internal shipment progress enum, resolved from Delhivery scan history. Set to created when AWB is assigned; updated on each track API call.';


--
-- Name: return_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    user_id uuid,
    type character varying(20) NOT NULL,
    status character varying(50) DEFAULT 'pending_approval'::character varying NOT NULL,
    reason character varying(100) NOT NULL,
    description text,
    admin_notes text,
    return_tracking_number character varying(255),
    received_at timestamp with time zone,
    resolved_at timestamp with time zone,
    replacement_order_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rvp_awb_number character varying(64),
    rvp_created_at timestamp with time zone,
    image_urls text[] DEFAULT '{}'::text[],
    valuation_status character varying(20) DEFAULT NULL::character varying,
    valuation_condition character varying(20) DEFAULT NULL::character varying,
    valuation_notes text,
    valuated_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone
);


--
-- Name: return_request_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_request_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    return_request_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    refund_amount numeric(12,2) NOT NULL,
    product_name character varying(255),
    variant_name character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT return_request_items_pkey PRIMARY KEY (id)
);


-- FK: return_request_items cross-references return_requests and order_items (same file)
ALTER TABLE ONLY public.return_request_items
    ADD CONSTRAINT return_request_items_return_request_id_fkey
    FOREIGN KEY (return_request_id) REFERENCES public.return_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.return_request_items
    ADD CONSTRAINT return_request_items_order_item_id_fkey
    FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;

-- FK: return_requests.reviewed_by references admins (defined in users.sql)
ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.admins(id) ON DELETE SET NULL;
