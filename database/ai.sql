-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: admin_agent_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid,
    kind character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'proposed'::character varying NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by_admin_id uuid,
    executed_at timestamp with time zone,
    result jsonb,
    error text
);


--
-- Name: admin_agent_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    filename character varying(255),
    mime_type character varying(64) NOT NULL,
    byte_size integer NOT NULL,
    data bytea NOT NULL,
    extracted_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '02:00:00'::interval) NOT NULL
);


--
-- Name: admin_agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text,
    tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ui_blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
    proposed_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    pickers jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: admin_agent_proposed_tools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_proposed_tools (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    proposed_by_admin_id uuid NOT NULL,
    source_prompt text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    args_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    kind text NOT NULL,
    sql_template text,
    email_template jsonb,
    status text DEFAULT 'proposed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by_admin_id uuid,
    rejection_reason text,
    invocation_count integer DEFAULT 0 NOT NULL,
    last_invoked_at timestamp with time zone,
    CONSTRAINT admin_agent_proposed_tools_kind_chk CHECK ((kind = ANY (ARRAY['readonly_sql'::text, 'templated_email'::text]))),
    CONSTRAINT admin_agent_proposed_tools_status_chk CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'retired'::text])))
);


--
-- Name: ai_briefing_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_briefing_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    briefing_date date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    sections jsonb DEFAULT '{}'::jsonb,
    error text
);


--
-- Name: ai_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ai_query_id uuid,
    user_id uuid NOT NULL,
    product_id uuid,
    signal character varying(32) NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    query_text text NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    recommended_count integer DEFAULT 0 NOT NULL,
    response_ms integer,
    model character varying(64),
    prompt_tokens integer,
    completion_tokens integer,
    cost_inr numeric(8,4),
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recommended_product_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL
);


--
-- Name: embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_table character varying(64),
    source_id text,
    content text,
    content_hash text,
    embedding public.vector(768),
    metadata jsonb,
    updated_at timestamp with time zone,
    CONSTRAINT embeddings_pkey PRIMARY KEY (id),
    CONSTRAINT embeddings_source_table_source_id_key UNIQUE (source_table, source_id)
);

CREATE INDEX idx_embeddings_source_table ON public.embeddings USING btree (source_table);
CREATE INDEX idx_embeddings_content_hash ON public.embeddings USING btree (content_hash);


--
-- Name: product_ai_enrichment_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_ai_enrichment_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    source_name text NOT NULL,
    source_desc text,
    ai_description text NOT NULL,
    ai_use_cases text[] DEFAULT '{}'::text[] NOT NULL,
    model text NOT NULL,
    prompt_tokens integer,
    completion_tokens integer,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by_admin_id uuid,
    promoted_at timestamp with time zone,
    re_embedded_at timestamp with time zone,
    error text,
    ai_keywords text[],
    ai_who_uses_it text,
    ai_application text,
    ai_product_type text,
    ai_features text[],
    ai_search_tags text[],
    CONSTRAINT product_ai_enrichment_log_status_chk CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'failed'::text])))
);


