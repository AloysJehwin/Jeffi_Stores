-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

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


--
-- Name: user_oauth_identities; Type: TABLE; Schema: public; Owner: -
--
-- Social sign-in links (Google, Facebook, Apple, GitHub) for customer and business users. One row per
-- provider account and user: the same provider account can back a customer and a business user.

CREATE TABLE public.user_oauth_identities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    subject text NOT NULL,
    email character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone
);
