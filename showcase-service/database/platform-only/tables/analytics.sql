-- showcase-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

--
-- showcase_sessions: one row per visit to a Showcase (a browser tab's sessionStorage id, like the storefront's
-- page_events.session_id), written by showcase-service's POST /api/track and read by the console's analytics page.
-- No raw IP: visitor_key is an HMAC of the site, IP and user agent, used only to tell new from returning visitors and
-- to link an enquiry to its visit. Attribution is the landing URL's (UTM tags, which ad click id it carried) and the
-- referring host.
--
CREATE TABLE IF NOT EXISTS public.showcase_sessions (
    id                 uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    site_id            uuid NOT NULL,
    session_id         character varying(64) NOT NULL,
    visitor_key        character varying(64) NOT NULL,
    is_new             boolean NOT NULL DEFAULT true,                  -- no visit with this visitor_key in the 90 days before
    started_at         timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at       timestamp with time zone NOT NULL DEFAULT now(),
    landing_path       character varying(500) NOT NULL DEFAULT '/',
    referrer           character varying(500),                         -- origin and path only
    ref_host           character varying(253),
    utm_source         character varying(255),
    utm_medium         character varying(255),
    utm_campaign       character varying(255),
    utm_term           character varying(255),
    utm_content        character varying(255),
    click_id           character varying(8),                           -- gclid|gbraid|wbraid|fbclid|msclkid: which ad click id the landing URL had, not its value
    device             character varying(16) NOT NULL DEFAULT 'Desktop',
    browser            character varying(32) NOT NULL DEFAULT 'Unknown',
    os                 character varying(32) NOT NULL DEFAULT 'Unknown',
    country            character(2),                                   -- a CDN geo header, else the browser's time zone or locale
    region             character varying(80),                          -- a CDN geo header only
    city               character varying(80),                          -- a CDN geo header only
    timezone           character varying(64),
    language           character varying(16),
    screen_w           smallint,
    screen_h           smallint,
    viewport_w         smallint,
    net                character varying(8),                           -- navigator.connection.effectiveType
    pageviews          integer NOT NULL DEFAULT 1,
    max_scroll         smallint NOT NULL DEFAULT 0,                    -- deepest scroll, % of the page
    engaged_ms         integer NOT NULL DEFAULT 0,                     -- time the page was visible
    contact_at         timestamp with time zone,                       -- first call, WhatsApp or email tap
    form_started_at    timestamp with time zone,
    form_submitted_at  timestamp with time zone
);

-- showcase_events: what a visit did, in order: page views, taps on contact and outbound links, and the contact form.
CREATE TABLE IF NOT EXISTS public.showcase_events (
    id          uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    site_id     uuid NOT NULL,
    session_id  character varying(64) NOT NULL,
    type        character varying(16) NOT NULL,                        -- pageview|click|form_start|form_submit
    target      character varying(16),                                 -- click: call|whatsapp|email|map|social|link
    label       character varying(120),                                -- click: the social network or the link's host
    path        character varying(500),
    created_at  timestamp with time zone NOT NULL DEFAULT now()
);
