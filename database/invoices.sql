-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: cash_sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_sale_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    product_name character varying NOT NULL,
    product_sku character varying,
    variant_name character varying,
    hsn_code character varying,
    gst_rate numeric DEFAULT 18 NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    discount_amount numeric DEFAULT 0 NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    total_price numeric NOT NULL,
    taxable_amount numeric DEFAULT 0 NOT NULL,
    cgst_amount numeric DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0 NOT NULL,
    igst_amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sub_variant_id uuid,
    buy_unit character varying(20),
    buy_mode character varying(10) DEFAULT 'unit'::character varying
);



--
-- Name: cash_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_sales (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sale_number character varying NOT NULL,
    invoice_number character varying,
    invoice_date timestamp with time zone DEFAULT now(),
    financial_year character varying,
    sequence_number integer,
    customer_name character varying DEFAULT 'Walk-in Customer'::character varying NOT NULL,
    customer_phone character varying,
    payment_mode character varying DEFAULT 'cash'::character varying NOT NULL,
    payment_status character varying DEFAULT 'paid'::character varying NOT NULL,
    subtotal numeric NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    total_amount numeric NOT NULL,
    taxable_amount numeric DEFAULT 0 NOT NULL,
    cgst_amount numeric DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0 NOT NULL,
    igst_amount numeric DEFAULT 0 NOT NULL,
    is_igst boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector,
    status character varying DEFAULT 'active'::character varying NOT NULL
);



--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    invoice_number character varying(50),
    financial_year character varying(10),
    sequence_number integer,
    pdf_url character varying(500),
    generated_at timestamp with time zone DEFAULT now(),
    sale_id uuid,
    status character varying(10) DEFAULT 'finalized'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'finalized'::character varying])::text[])))
);

