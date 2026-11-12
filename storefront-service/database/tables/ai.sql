-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

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
