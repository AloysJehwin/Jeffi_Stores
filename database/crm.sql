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

CREATE TABLE public.customer_notes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_id uuid
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
    updated_at timestamp with time zone DEFAULT now()
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
    created_at timestamp with time zone DEFAULT now()
);

