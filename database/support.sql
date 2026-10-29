-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
-- sender: customer | admin | ai | bot | system ('user' is the pre-2026-10 web-chat spelling of customer).
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    sender character varying(10) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    admin_id uuid,
    channel character varying(16) DEFAULT 'web'::character varying NOT NULL,
    client_id character varying(64),
    payload jsonb,
    lang character varying(10),
    translations jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(12) DEFAULT 'sent'::character varying NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    provider character varying(16),
    provider_sid character varying(128),
    error text
);


--
-- Name: support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    tenant_id uuid,
    status character varying(20) DEFAULT 'open'::character varying,
    admin_name character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    ticket_number character varying(24),
    channel character varying(16) DEFAULT 'web'::character varying NOT NULL,
    handler character varying(10) DEFAULT 'ai'::character varying NOT NULL,
    assigned_admin_id uuid,
    handoff_reason text,
    handoff_summary text,
    handoff_at timestamp with time zone,
    customer_lang character varying(10),
    contact_phone character varying(20),
    contact_name character varying(120),
    customer_last_seen_at timestamp with time zone,
    admin_last_seen_at timestamp with time zone,
    last_message_at timestamp with time zone,
    customer_notified_at timestamp with time zone,
    wa_window_expires_at timestamp with time zone
);


--
-- Name: support_ticket_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_message_attachments; Type: TABLE; Schema: public; Owner: -
-- A file on a support message; the bytes live in the Drive (drive_files).
--

CREATE TABLE public.support_message_attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    drive_file_id uuid,
    kind character varying(12) NOT NULL,
    mime_type character varying(120) NOT NULL,
    name character varying(255) NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    width integer,
    height integer,
    duration_seconds numeric(10,2),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_ai_actions; Type: TABLE; Schema: public; Owner: -
-- An action the support AI proposed (cancel, return, address change) and what became of it.
--

CREATE TABLE public.support_ai_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    message_id uuid,
    kind character varying(40) NOT NULL,
    args jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now(),
    decided_at timestamp with time zone
);
