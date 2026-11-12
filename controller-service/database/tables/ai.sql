-- controller-service: tables. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: admin_agent_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid,
    kind character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'proposed'::character varying NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by_admin_id uuid,
    executed_at timestamp with time zone,
    result jsonb,
    error text,
    decided_via character varying(16)
);
