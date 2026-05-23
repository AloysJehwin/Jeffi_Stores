-- Module: 11_logs
--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    email character varying(255) NOT NULL,
    subject character varying(255),
    template_name character varying(100),
    status character varying(50) DEFAULT 'sent'::character varying,
    sent_at timestamp with time zone DEFAULT now(),
    metadata jsonb
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    link character varying(500),
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: page_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(64) NOT NULL,
    user_id uuid,
    page character varying(32) NOT NULL,
    path text NOT NULL,
    referrer text,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_views (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    user_id uuid,
    session_id character varying(255),
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: search_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_queries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    query character varying(255) NOT NULL,
    results_count integer,
    clicked_product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


