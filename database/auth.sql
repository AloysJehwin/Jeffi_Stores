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
    ip_address character varying(64)
);
