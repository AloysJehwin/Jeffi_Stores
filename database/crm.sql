-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: business_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_discounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_discounts_discount_pct_check CHECK (((discount_pct >= (0)::numeric) AND (discount_pct <= (100)::numeric)))
);


--
-- Name: business_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    company_name text NOT NULL,
    gst_number text NOT NULL,
    business_address text NOT NULL,
    industry text NOT NULL,
    approval_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid,
    kind character varying(64) NOT NULL,
    reference_id uuid,
    reference_type character varying(64),
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_health (
    user_id uuid NOT NULL,
    score integer NOT NULL,
    recency_score integer DEFAULT 0 NOT NULL,
    frequency_score integer DEFAULT 0 NOT NULL,
    monetary_score integer DEFAULT 0 NOT NULL,
    engagement_score integer DEFAULT 0 NOT NULL,
    satisfaction_score integer DEFAULT 70 NOT NULL,
    churn_risk character varying(20) DEFAULT 'healthy'::character varying NOT NULL,
    trend_delta_7d integer DEFAULT 0 NOT NULL,
    trend_delta_30d integer DEFAULT 0 NOT NULL,
    last_computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_health_churn_risk_check CHECK (((churn_risk)::text = ANY ((ARRAY['healthy'::character varying, 'rising_concern'::character varying, 'high'::character varying])::text[]))),
    CONSTRAINT customer_health_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: customer_health_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_health_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    score integer NOT NULL,
    churn_risk character varying(20) NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_notes; Type: TABLE; Schema: public; Owner: -
--

-- customer_notes gained source / title / tags / shared_with_customer / return_request_id on
-- 2026-09-24. Existing tenants receive them through the fan-out's per-table column
-- reconciliation (src/lib/tenant-migrations-schema.ts), which must run before the CHECK on
-- source and the partial index on shared_with_customer below.
CREATE TABLE public.customer_notes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_id uuid,
    title character varying(200),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    order_id uuid,
    return_request_id uuid,
    shared_with_customer boolean DEFAULT false NOT NULL,
    source character varying(20) DEFAULT 'admin_panel'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_note_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_note_attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    note_id uuid NOT NULL,
    kind character varying(10) DEFAULT 'image'::character varying NOT NULL,
    s3_key character varying(500) NOT NULL,
    s3_thumbnail_key character varying(500),
    mime_type character varying(100) NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    width integer,
    height integer,
    duration_seconds integer,
    original_name character varying(255),
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    company_name character varying(255),
    gst_number character varying(50),
    customer_type character varying(50) DEFAULT 'retail'::character varying,
    credit_limit numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ai_summary text,
    ai_summary_at timestamp with time zone
);


--
-- Name: customer_tag_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tag_definitions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tag character varying(60) NOT NULL,
    color character varying(20) DEFAULT 'accent'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: customer_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tags (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tag character varying(60) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: customer_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_by uuid,
    assigned_to uuid,
    title character varying(255) NOT NULL,
    description text,
    due_date date,
    priority character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_kind character varying(64),
    source_ref_id character varying(128),
    auto_created boolean DEFAULT false NOT NULL,
    CONSTRAINT customer_tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT customer_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
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
    created_at timestamp with time zone DEFAULT now(),
    category character varying(24),
    image_url character varying(500),
    source character varying(16),
    source_ref character varying(120),
    opened_at timestamp with time zone
);


--
-- Name: push_devices; Type: TABLE; Schema: public; Owner: -
-- App installs that can receive a push. user_id is NULL for a signed-out install.
--

CREATE TABLE public.push_devices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    token text NOT NULL,
    platform character varying(16) NOT NULL,
    app_version character varying(40),
    os_version character varying(40),
    locale character varying(35),
    timezone character varying(64) DEFAULT 'Asia/Kolkata'::character varying,
    offers_opt_in boolean DEFAULT false NOT NULL,
    offers_opt_in_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    disabled_reason character varying(64)
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
-- Per-category channel choices. A missing row means the category default.
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    category character varying(24) NOT NULL,
    push boolean DEFAULT true NOT NULL,
    email boolean DEFAULT true NOT NULL,
    sms boolean DEFAULT true NOT NULL,
    whatsapp boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_sends; Type: TABLE; Schema: public; Owner: -
-- Marketing pushes delivered, one row per person (or signed-out install) per send, for the daily cap
-- shared by the Mailer and scenarios. event_ref: the Mailer campaign id or the scenario's inbox row id.
--

CREATE TABLE public.push_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    push_device_id uuid,
    source character varying(16) NOT NULL,
    event_ref character varying(120) NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_queue; Type: TABLE; Schema: public; Owner: -
-- Scenario pushes held for quiet hours; the inbox row carries the payload.
--

CREATE TABLE public.push_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    push_device_id uuid NOT NULL,
    send_after timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: admin_notifications; Type: TABLE; Schema: public; Owner: -
-- Admin bell feed. recipient_admin_id NULL = every admin whose scopes allow the row; set = that admin only.
--

CREATE TABLE public.admin_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    type character varying(50) NOT NULL,
    category character varying(24) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    link character varying(500),
    entity_type character varying(40),
    entity_id character varying(64),
    severity character varying(12) DEFAULT 'info'::character varying NOT NULL,
    scope character varying(48),
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_admin_id uuid
);
