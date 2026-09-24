-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    user_id uuid,
    rating integer,
    title character varying(255),
    comment text,
    is_verified_purchase boolean DEFAULT false,
    is_approved boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    image_thumbnail_urls text[] DEFAULT '{}'::text[] NOT NULL,
    image_urls text[] DEFAULT '{}'::text[] NOT NULL,
    order_id uuid,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
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
-- Name: review_form_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_form_drafts (
    form_id uuid NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_form_drafts_pkey PRIMARY KEY (form_id)
);


--
-- Name: review_form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_form_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_id uuid,
    phone character varying(15),
    screenshot_url text NOT NULL,
    coupon_code character varying(50),
    status character varying(20) DEFAULT 'pending'::character varying,
    submitted_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    extra_fields jsonb DEFAULT '{}'::jsonb
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


--
-- Name: wishlist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlist_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    snapshot_price numeric(12,2),
    snapshot_in_stock boolean,
    snapshot_taken_at timestamp with time zone
);
