-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: shipping_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_zones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    states jsonb,
    base_rate numeric(10,2) NOT NULL,
    per_kg_rate numeric(10,2) DEFAULT 0,
    free_shipping_threshold numeric(12,2),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    data_type character varying(50) DEFAULT 'string'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
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



--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

