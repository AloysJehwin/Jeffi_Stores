-- admin-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: review_form_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_form_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_admin_id uuid,
    title character varying(120),
    base jsonb,
    base_revision integer DEFAULT 0 NOT NULL,
    form_id uuid NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_form_drafts_pkey PRIMARY KEY (id)
);


--
-- Name: review_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    google_review_url text NOT NULL,
    coupon_id uuid,
    is_active boolean DEFAULT true,
    submissions_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    custom_fields jsonb DEFAULT '[]'::jsonb,
    template_type text DEFAULT 'google_review'::text NOT NULL,
    is_draft boolean DEFAULT false NOT NULL
);
