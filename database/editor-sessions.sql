--
-- Name: editor_sessions; Type: TABLE; Schema: public; Owner: -
--
-- One row per open admin edit session. Snapshot captures the pre-edit draft
-- state so Cancel can roll back everything the autosave flushed since the
-- admin opened the editor. closed_at NULL = session is live.
--

CREATE TABLE public.editor_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    resource_type character varying(32) NOT NULL,
    resource_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    change_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_reason character varying(16)
);


--
-- Name: draft_locks; Type: TABLE; Schema: public; Owner: -
--
-- Who owns a draft, one row per (resource_type, resource_id). A draft belongs to the admin who
-- started it until it is published or discarded; owner_admin_id NULL = released / unclaimed.
-- epoch +1 on every owner change (a fencing token for stale tabs); updated_at is the realtime
-- cursor. Closed rows stay 7 days as tombstones so viewers can read "Published by …".
--

CREATE TABLE public.draft_locks (
    resource_type character varying(32) NOT NULL,
    resource_id uuid NOT NULL,
    owner_admin_id uuid,
    started_by_admin_id uuid,
    previous_owner_admin_id uuid,
    acquired_via character varying(16) DEFAULT 'start'::character varying NOT NULL,
    takeover_reason text,
    epoch integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_reason character varying(16),
    closed_by_admin_id uuid
);


--
-- Name: draft_presence; Type: TABLE; Schema: public; Owner: -
--
-- Who has a draft open right now (one row per admin tab), display only. Rows older than
-- 45 s are ignored and the sweep deletes them.
--

CREATE TABLE public.draft_presence (
    resource_type character varying(32) NOT NULL,
    resource_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    tab_id character varying(64) NOT NULL,
    mode character varying(8) DEFAULT 'view'::character varying NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL
);
