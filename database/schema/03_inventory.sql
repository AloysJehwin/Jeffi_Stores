-- Module: 03_inventory
--
-- Name: grn_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grn_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    grn_id uuid,
    po_item_id uuid,
    product_id uuid,
    variant_id uuid,
    quantity_received numeric(10,3) NOT NULL,
    unit_cost numeric(12,2) NOT NULL
);


--
-- Name: grns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grns (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    grn_number character varying(50) NOT NULL,
    po_id uuid,
    supplier_id uuid,
    received_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    variant_id uuid,
    transaction_type character varying(50) NOT NULL,
    quantity_change integer NOT NULL,
    quantity_after integer NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_inflation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_inflation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    category_name character varying(100) NOT NULL,
    percentage numeric(5,2) NOT NULL,
    applied_fields text[] NOT NULL,
    product_count integer DEFAULT 0 NOT NULL,
    applied_by character varying(100),
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot jsonb,
    is_rollback boolean DEFAULT false NOT NULL,
    rolled_back_at timestamp with time zone,
    rolled_back_by character varying(100)
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    gstin character varying(20),
    contact_name character varying(255),
    phone character varying(20),
    email character varying(255),
    address text,
    payment_terms integer DEFAULT 30,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bank_name text,
    account_number text,
    ifsc text,
    upi_id text
);


