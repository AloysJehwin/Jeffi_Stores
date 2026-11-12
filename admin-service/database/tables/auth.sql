-- admin-service: tables. Load order comes from scripts/db-files.mjs.

-- Auth sessions — server-side revocable sessions backing the JWT `sid` claim.
-- Each login creates a row; the Node-layer authenticate* functions validate the
-- session (revoked / idle / absolute expiry) on every request, enabling instant
-- revocation and idle timeout that stateless JWTs alone cannot provide.


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    principal_type character varying(16) NOT NULL,
    principal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    user_agent character varying(500),
    ip_address character varying(64),
    role character varying(50),
    scopes jsonb DEFAULT '[]'::jsonb,
    cert_cn character varying(255),
    approval_status character varying(20),
    accept_lang character varying(16),
    ua_platform character varying(32),
    ip_net character varying(64),
    fp_hash character varying(64),
    token_hash character varying(64),
    tenant_id uuid
);

--
-- Name: auth_session_keys; Type: TABLE; Schema: public; Owner: -
-- The public half of the signing key a browser registered for a session. The private half is
-- non-extractable in that browser, so a copied session cookie cannot produce valid proofs.
-- Kept apart from auth_sessions on purpose: the session hot path never depends on this table,
-- so a database the schema has not reached yet cannot break logins.
--

CREATE TABLE public.auth_session_keys (
    session_id uuid NOT NULL,
    public_jwk jsonb NOT NULL,
    bind_host character varying(255) NOT NULL,
    last_refresh_ts bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
