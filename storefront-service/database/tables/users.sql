-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    address_type character varying(50) DEFAULT 'shipping'::character varying,
    is_default boolean DEFAULT false,
    full_name character varying(255) NOT NULL,
    phone character varying(20) NOT NULL,
    address_line1 character varying(255) NOT NULL,
    address_line2 character varying(255),
    landmark character varying(255),
    city character varying(100) NOT NULL,
    state character varying(100) NOT NULL,
    postal_code character varying(20) NOT NULL,
    country character varying(100) DEFAULT 'India'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    state_code character varying(3)
);



--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    first_name character varying(100),
    last_name character varying(100),
    password_hash character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    is_active boolean DEFAULT true,
    is_guest boolean DEFAULT false,
    session_id text,
    merged_to_user_id uuid,
    is_flagged boolean DEFAULT false,
    flag_reason text,
    google_id text,
    auth_provider character varying(20) DEFAULT 'email'::character varying,
    marketing_opt_out boolean DEFAULT false NOT NULL,
    marketing_opt_out_at timestamp with time zone,
    unsubscribe_token uuid DEFAULT gen_random_uuid(),
    avatar_url text,
    avatar_s3_key text,
    avatar_is_custom boolean DEFAULT false NOT NULL,
    user_type character varying(20) DEFAULT 'customer'::character varying NOT NULL,
    policies_accepted_version text,
    policies_accepted_at timestamp with time zone,
    notification_channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    phone_verified boolean DEFAULT false NOT NULL,
    phone_verified_at timestamp with time zone,
    date_of_birth date,
    deleted_at timestamp with time zone
);

UPDATE public.admins a SET role = 'administrator'
FROM public.users u
WHERE a.user_id = u.id AND LOWER(u.email) = 'admin@jeffistores.in' AND a.role <> 'administrator';
