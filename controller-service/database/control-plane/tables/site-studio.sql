--
-- site_studio_sessions: the AI Site Studio an owner runs in the onboarding wizard's "Your site" step
-- (controller-service/src/lib/site-studio/), and the Showcase builder's (product 'showcase', lib/showcase). The
-- store's is one per owner; a Showcase's one per site (site_id). Each holds the brief, the page plan, the design
-- directions and
-- the site the AI wrote (page key → PageDoc of code sections), previewed on sample products and installed into the
-- store by the build_site provisioning step. free_used_at marks the owner's one free full-site generation, which
-- stops once spent_inr reaches its budget; tweaks are free but capped per day (tweaks_today on tweaks_day).
--
CREATE TABLE IF NOT EXISTS public.site_studio_sessions (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id      uuid NOT NULL,
    product       character varying(16) NOT NULL DEFAULT 'store', -- store|showcase: what it designs for
    site_id       uuid,                                            -- a Showcase's site (showcase_sites.id); null for the store's
    status        character varying(16) NOT NULL DEFAULT 'brief', -- brief|plan|direction|building|ready|failed
    answers       jsonb NOT NULL DEFAULT '{}'::jsonb,              -- the owner's answers to the brief questions
    brief         jsonb,                                           -- StudioBrief
    plan          jsonb,                                           -- StudioPlan, with the owner's optional-page toggles
    directions    jsonb NOT NULL DEFAULT '[]'::jsonb,              -- DesignDirection[] offered
    direction     jsonb,                                           -- the chosen DesignDirection
    catalog       jsonb,                                           -- SampleCatalog the preview renders
    pages         jsonb NOT NULL DEFAULT '{}'::jsonb,              -- page key → PageDoc
    theme         jsonb,                                           -- ThemeTokens of the chosen direction
    progress      jsonb,                                           -- the build's last progress (a reconnecting wizard reads it)
    error         text,
    spent_inr     numeric(10,4) NOT NULL DEFAULT 0,                -- platform-funded AI spend so far (the free generation stops at its cap)
    free_used_at  timestamp with time zone,                        -- the free full-site generation was claimed
    generated_at  timestamp with time zone,                        -- ...and finished every page
    tweaks_today  integer NOT NULL DEFAULT 0,
    tweaks_day    date,
    tenant_id     uuid,                                            -- the store it was installed into
    installed_at  timestamp with time zone,
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

--
-- site_studio_corrections: an owner's AI changes after their studio site is built (a section changed, a page
-- designed again), counted per IST day across their studios. The first CORRECTIONS_FREE_PER_DAY are free; the rest
-- are charged per correction to the AI wallet (controller-service/src/lib/site-studio/corrections.ts).
--
CREATE TABLE IF NOT EXISTS public.site_studio_corrections (
    owner_id  uuid NOT NULL,
    day       date NOT NULL,
    used      integer NOT NULL DEFAULT 0, -- free corrections used that day
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
