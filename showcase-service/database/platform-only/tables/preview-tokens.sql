-- showcase-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

--
-- showcase_preview_tokens: one row per no-login preview link (packages/store-core/src/lib/showcase/preview-token.ts),
-- keyed by the token's jti. A token is good only while its row is unrevoked and now() < expires_at: 24h while the
-- site is a draft, cut to 30 minutes from the first publish.
--
CREATE TABLE IF NOT EXISTS public.showcase_preview_tokens (
    jti         uuid NOT NULL,
    site_id     uuid NOT NULL,
    expires_at  timestamp with time zone NOT NULL,
    revoked_at  timestamp with time zone,
    created_at  timestamp with time zone NOT NULL DEFAULT now()
);
