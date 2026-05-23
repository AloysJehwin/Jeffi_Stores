-- Module: 12_support
--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    sender character varying(10) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    status character varying(20) DEFAULT 'open'::character varying,
    admin_name character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone
);


--
-- Name: websocket_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.websocket_connections (
    connection_id character varying(200) NOT NULL,
    user_id uuid,
    session_id uuid,
    role character varying(10) NOT NULL,
    connected_at timestamp with time zone DEFAULT now()
);


