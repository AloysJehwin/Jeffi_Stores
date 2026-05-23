-- Module: 04_orders
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
    buy_unit character varying(10)
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
    buy_unit character varying(10)
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
    view_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: wishlist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlist_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


