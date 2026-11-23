-- showcase-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

--
-- showcase_sites: a Showcase, the one-page site of a business served at site-{slug}.<root> by showcase-service
-- (packages/store-core/src/lib/showcase). Read and written through the control-plane pool: a Showcase-only workspace
-- has no store database. Hosting is free for SHOWCASE_TRIAL_DAYS from the first publish, then a showcase_site line on the
-- workspace's subscription (controller-service/src/lib/billing); billing writes paid_until.
--
CREATE TABLE IF NOT EXISTS public.showcase_sites (
    id                       uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id                uuid,                                    -- the workspace whose wallet pays (no FK: control-plane set loads later)
    owner_id                 uuid NOT NULL,
    slug                     character varying(58) NOT NULL,          -- site-{slug}.<root>; 58 keeps the label within 63
    status                   character varying(16) NOT NULL DEFAULT 'draft', -- draft|live|paused
    business                 jsonb NOT NULL DEFAULT '{}'::jsonb,      -- ShowcaseBusiness
    content                  jsonb NOT NULL DEFAULT '{}'::jsonb,      -- ShowcaseContent
    page                     jsonb,                                   -- PageDoc (key showcase:home), null until made
    theme                    jsonb,                                   -- ThemeTokens
    paid_until               timestamp with time zone,                -- hosting paid up to here
    renew                    boolean NOT NULL DEFAULT true,
    pause_reason             character varying(16),                   -- owner|unpaid while paused
    renewal_reminded_for     timestamp with time zone,                -- the paid_until the 3-day reminder went out for
    charge_failed_at         timestamp with time zone,                -- first failed renewal of the current period
    last_charge_error        text,
    free_generation_used_at  timestamp with time zone,
    generations              integer NOT NULL DEFAULT 0,
    custom_domain            character varying(253),
    published_at             timestamp with time zone,                -- the first publish (starts the trial)
    trial_ends_at            timestamp with time zone,                -- set at the first publish; the billing sweep pauses an unpaid site then
    created_at               timestamp with time zone NOT NULL DEFAULT now(),
    updated_at               timestamp with time zone NOT NULL DEFAULT now()
);

-- showcase_leads: enquiries from a Showcase's contact form (POST /api/leads on the site's host).
CREATE TABLE IF NOT EXISTS public.showcase_leads (
    id          uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    site_id     uuid NOT NULL,
    name        character varying(120) NOT NULL,
    phone       character varying(32),
    email       character varying(254),
    message     text,
    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    read_at     timestamp with time zone,
    session_id  character varying(64)                -- the showcase_sessions visit it came from, when one matched
);
