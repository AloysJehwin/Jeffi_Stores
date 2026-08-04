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
-- Name: admin_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_certificates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    serial_number character varying(100) NOT NULL,
    common_name character varying(255) NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    is_revoked boolean DEFAULT false,
    revoked_at timestamp with time zone,
    download_token character varying(255),
    downloaded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    p12_data bytea,
    p12_password character varying(64)
);



--
-- Name: admin_mfa_recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_mfa_recovery_codes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'admin'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    scopes jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    mfa_secret_enc text,
    mfa_enabled boolean DEFAULT false NOT NULL,
    mfa_enrolled_at timestamp with time zone
);



--
-- Name: failed_login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255),
    user_id uuid,
    ip_address character varying(64),
    user_agent text,
    reason character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    otp character varying(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: service_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    serial_number text NOT NULL,
    common_name text NOT NULL,
    allowed_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp with time zone,
    p12_data bytea,
    p12_password text,
    p12_downloaded boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
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
    policies_accepted_at timestamp with time zone
);
