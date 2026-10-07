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

ALTER TABLE ONLY public.auth_session_keys
    ADD CONSTRAINT auth_session_keys_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id) ON DELETE CASCADE;

-- tenant_id (multi-tenant SaaS): the tenant this session belongs to, snapshotted at
-- login (mirrors role/scopes). Nullable / no default on purpose — the platform's own
-- flagship store and existing rows stay NULL (single-tenant), so resolveSession() and
-- the host->tenant mismatch check fail OPEN for them (no mass logout on deploy). The
-- tenants registry lives in a SEPARATE control-plane DB, so there is intentionally NO
-- cross-DB FK here; tenant membership is validated in the app layer against a
-- host-resolved tenant.

-- Device-binding signal snapshot (added for multi-signal session binding).
-- All nullable / no default on purpose: existing rows stay NULL so resolveSession()
-- fails OPEN for them (no mass logout on deploy). accept_lang = primary language
-- subtag (e.g. 'en'); ua_platform = normalized Sec-CH-UA-Platform (e.g. 'macos');
-- ip_net = derived /16 (v4) or hextet-prefix (v6) network — NEVER the raw IP (that
-- stays in ip_address for display only); fp_hash = SHA-256 of the client canvas/webgl
-- fingerprint. STABLE signals (ua_platform, accept_lang + user_agent family) gate
-- revocation; ip_net + fp_hash are SOFT/advisory and never trigger a revoke alone.


--
-- Name: vault_tickets; Type: TABLE; Schema: public; Owner: -
--
-- Single-use SSO handoff tickets. The store mints a ticket (storing only its SHA-256 hash),
-- redirects to the vault host, which looks up by hash, burns it (used_at), and issues a vault
-- session. Lives in the tenant DB so a ticket from tenant A cannot be replayed on tenant B.

CREATE TABLE public.vault_tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_hash character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    principal_type character varying(12) NOT NULL,
    target_path character varying(512),
    -- SHA-256 of the vault_state cookie the vault host set before bouncing to the store. The callback
    -- must present the matching cookie, so a ticket can't be planted in another browser (login CSRF).
    state_hash character varying(64),
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
