-- controller-service: Outreach program (AI call -> Showcase site -> WhatsApp). Platform-only: the flagship DB, never a store tenant's.

CREATE TABLE IF NOT EXISTS public.outreach_program_state (
    program text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    daily_cap integer NOT NULL DEFAULT 50,
    concurrency integer NOT NULL DEFAULT 2,
    window_start time without time zone NOT NULL DEFAULT '09:30',
    window_end time without time zone NOT NULL DEFAULT '20:30',
    test_numbers text[] NOT NULL DEFAULT '{}',
    default_skill_id uuid,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.outreach_lists (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    program text NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    spreadsheet_id text,
    sheet_title text,
    file_key text,
    row_count integer NOT NULL DEFAULT 0,
    last_synced_at timestamp with time zone,
    skill_id uuid,
    skill_version_id uuid,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    list_id uuid,
    program text NOT NULL,
    phone text NOT NULL,
    business_name text NOT NULL,
    owner_name text,
    category text,
    city text,
    address text,
    language text,
    source text NOT NULL,
    extra jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'new',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamp with time zone,
    last_call_id uuid,
    showcase_site_id uuid,
    claim_token_hash text,
    claimed_owner_id uuid,
    consent_whatsapp_at timestamp with time zone,
    consent_evidence jsonb,
    opted_out_at timestamp with time zone,
    dnd_status text NOT NULL DEFAULT 'unknown',
    dnd_checked_at timestamp with time zone,
    wa_window_expires_at timestamp with time zone,
    handoff_at timestamp with time zone,
    handoff_reason text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_calls (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contact_id uuid NOT NULL,
    provider text,
    provider_call_id text,
    language text,
    status text NOT NULL DEFAULT 'queued',
    outcome text,
    started_at timestamp with time zone,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_s integer,
    transcript jsonb,
    recording_key text,
    summary text,
    consent jsonb,
    callback_at timestamp with time zone,
    cost_paise integer,
    error text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contact_id uuid NOT NULL,
    direction text NOT NULL,
    template_slug text,
    body text,
    provider_message_id text,
    status text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_suppressions (
    phone text NOT NULL,
    reason text,
    source text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.outreach_events_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.outreach_events (
    id bigint DEFAULT nextval('public.outreach_events_id_seq'::regclass) NOT NULL,
    contact_id uuid,
    call_id uuid,
    kind text NOT NULL,
    data jsonb,
    actor text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Outreach agent (docs/plans/OUTREACH_AGENT_SKILLS.md): skills are Markdown playbooks uploaded per store (tenant_id
-- NULL = the flagship), versioned; a run pins one skill version for a contact across calls and WhatsApp; tasks are
-- the scheduled wake-ups (a follow-up call or a WhatsApp turn) that carry a run over days.

CREATE TABLE IF NOT EXISTS public.outreach_skills (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    program text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    current_version_id uuid,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_skill_versions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    skill_id uuid NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    meta jsonb NOT NULL DEFAULT '{}',
    sha256 text NOT NULL,
    validation jsonb NOT NULL DEFAULT '{}',
    source text NOT NULL DEFAULT 'upload',
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_agent_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contact_id uuid NOT NULL,
    skill_version_id uuid,
    skill_ref text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    turns integer NOT NULL DEFAULT 0,
    spend_paise integer NOT NULL DEFAULT 0,
    last_channel text,
    last_turn_at timestamp with time zone,
    notes jsonb NOT NULL DEFAULT '[]',
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    ended_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.outreach_agent_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    run_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    kind text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    reason text,
    instruction text,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    result jsonb,
    created_by text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    done_at timestamp with time zone
);
