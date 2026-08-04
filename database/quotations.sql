-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: business_rfq_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rfq_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rfq_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit text DEFAULT 'Nos'::text NOT NULL,
    notes text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_price numeric(12,2),
    sub_variant_id uuid,
    CONSTRAINT business_rfq_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: business_rfqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rfqs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rfq_number text NOT NULL,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    converted_quotation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_note text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone
);


--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    po_id uuid,
    product_id uuid,
    variant_id uuid,
    product_name character varying(255) NOT NULL,
    sku character varying(100),
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    tax_rate numeric(5,2) DEFAULT 0,
    total_cost numeric(12,2) NOT NULL,
    quantity_received numeric(10,3) DEFAULT 0,
    purchase_unit character varying(50),
    purchase_unit_factor numeric(14,6) DEFAULT 1 NOT NULL,
    line_total_incl_gst numeric(14,4),
    gst_inclusive boolean DEFAULT true NOT NULL
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    po_number character varying(50) NOT NULL,
    supplier_id uuid,
    status character varying(20) DEFAULT 'draft'::character varying,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    expected_date date,
    notes text,
    subtotal numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    view_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: quotation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quotation_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    description text NOT NULL,
    hsn_code character varying(20),
    gst_rate numeric(5,2) DEFAULT 18 NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    rate numeric(12,4) NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0,
    amount numeric(12,4) NOT NULL,
    product_id uuid,
    variant_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    sub_variant_id uuid,
    sold_unit character varying(20),
    sold_unit_factor numeric(14,6),
    base_quantity numeric(14,4),
    applied_rules jsonb,
    buy_unit character varying(20)
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quote_number character varying(60) NOT NULL,
    quote_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    consignee_name text,
    consignee_addr1 text,
    consignee_addr2 text,
    consignee_city text,
    consignee_state text DEFAULT 'Chhattisgarh'::text,
    consignee_gstin text,
    buyer_same boolean DEFAULT true NOT NULL,
    buyer_name text,
    buyer_addr1 text,
    buyer_addr2 text,
    buyer_city text,
    buyer_state text DEFAULT 'Chhattisgarh'::text,
    buyer_gstin text,
    notes text,
    subtotal numeric(12,4) DEFAULT 0,
    cgst_amount numeric(12,4) DEFAULT 0,
    sgst_amount numeric(12,4) DEFAULT 0,
    total_amount numeric(12,4) DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    converted_order_id uuid,
    consignee_phone character varying(20),
    consignee_pincode character varying(10),
    search_vector tsvector,
    buyer_phone character varying(20),
    buyer_pincode character varying(10),
    buyer_email text,
    consignee_email text,
    view_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: rfq_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rfq_id uuid NOT NULL,
    sender text NOT NULL,
    message text NOT NULL,
    counter_items jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rfq_messages_sender_check CHECK ((sender = ANY (ARRAY['admin'::text, 'customer'::text])))
);
