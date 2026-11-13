-- admin-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

--
-- Name: ai_prompt_presets; Type: TABLE; Schema: public; Owner: -
-- Prompt catalog for AI image/video generation. tenant_id NULL = platform default; non-null = tenant
-- override. feature NULL = applies to any feature. The UI loads the (tenant, kind, feature) rows
-- ordered by display_order and lets the operator pick a scenario.
--

CREATE TABLE public.ai_prompt_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    kind text NOT NULL,
    feature text,
    scenario text NOT NULL,
    prompt text NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
