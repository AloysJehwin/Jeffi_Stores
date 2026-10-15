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
