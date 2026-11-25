--
-- owner_attribution: where an ecom owner came from (Google Ads click ids and UTM tags), captured in a first-party
-- cookie on the ecom landing and saved once, when the owner is first created or first signs in. One row per owner.
-- owner_conversion_uploads: the offline conversions (ecom_signup, showcase_published, subscription_paid) owed to the
-- platform's Google Ads account for those owners; the ecom_conversions cron sends the pending ones. (owner_id, action)
-- is unique, so each conversion is queued and sent once.
--
CREATE TABLE IF NOT EXISTS public.owner_attribution (
    owner_id       uuid NOT NULL,
    gclid          character varying(255),
    gbraid         character varying(255),
    wbraid         character varying(255),
    utm            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- utm_source, utm_medium, utm_campaign, utm_term, utm_content
    landing_path   character varying(500),
    first_seen_at  timestamp with time zone NOT NULL DEFAULT now(),
    created_at     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_conversion_uploads (
    id               uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id         uuid NOT NULL,
    action           character varying(40) NOT NULL,        -- ecom_signup | showcase_published | subscription_paid
    status           character varying(16) NOT NULL DEFAULT 'pending', -- pending | uploaded | failed
    value_inr        numeric(12,2) NOT NULL DEFAULT 0,
    occurred_at      timestamp with time zone NOT NULL DEFAULT now(),
    attempts         integer NOT NULL DEFAULT 0,
    next_attempt_at  timestamp with time zone NOT NULL DEFAULT now(),
    last_error       text,
    request_id       character varying(120),                -- Google's request id for the accepted upload
    uploaded_at      timestamp with time zone,
    created_at       timestamp with time zone NOT NULL DEFAULT now(),
    updated_at       timestamp with time zone NOT NULL DEFAULT now()
);
