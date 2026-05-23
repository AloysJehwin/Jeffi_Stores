-- Module: 10_invoices
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
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
    search_vector tsvector
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    invoice_number character varying(50) NOT NULL,
    financial_year character varying(10) NOT NULL,
    sequence_number integer NOT NULL,
    pdf_url character varying(500),
    generated_at timestamp with time zone DEFAULT now()
);


