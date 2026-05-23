-- Module: 06_shipping
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
    rvp_created_at timestamp with time zone
);


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


