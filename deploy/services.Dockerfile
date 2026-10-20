# syntax=docker/dockerfile:1
# messaging-service, document-service and public-api-service. Build context: the repo root.
#   docker buildx build -f deploy/services.Dockerfile --target messaging|documents|public-api|mobile .
# The services run their TypeScript through tsx (the workspace packages ship raw TS too).
FROM node:20-alpine AS base
ENV npm_config_maxsockets=6 npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=120000
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
COPY packages ./packages
COPY messaging-service/package.json messaging-service/
COPY document-service/package.json document-service/
COPY public-api-service/package.json public-api-service/
COPY mobile-service/package.json mobile-service/

FROM base AS messaging-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --workspace=messaging-service
FROM base AS documents-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --workspace=document-service
FROM base AS public-api-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --workspace=public-api-service
FROM base AS mobile-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --workspace=mobile-service

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production SPAWN_APP=1 APP_NODE_ARGS="--import tsx"
RUN addgroup --system --gid 1001 svc && adduser --system --uid 1001 -G svc svc
COPY deploy/load-secrets.mjs deploy/load-secrets.mjs
# The services' tsconfigs extend it; without it tsx ignores them (document-service loses react-jsx).
COPY tsconfig.services.json ./

FROM runtime AS messaging
COPY --from=messaging-deps /app ./
COPY messaging-service ./messaging-service
ENV APP_ENTRY=messaging-service/src/server.ts APP_CWD=messaging-service PORT=3101
USER svc
EXPOSE 3101
CMD ["node", "deploy/load-secrets.mjs"]

FROM runtime AS documents
COPY --from=documents-deps /app ./
COPY document-service ./document-service
ENV APP_ENTRY=document-service/src/server.ts APP_CWD=document-service PORT=3102
USER svc
EXPOSE 3102
CMD ["node", "deploy/load-secrets.mjs"]

FROM runtime AS public-api
COPY --from=public-api-deps /app ./
COPY public-api-service ./public-api-service
ENV APP_ENTRY=public-api-service/src/server.ts APP_CWD=public-api-service PORT=3100
USER svc
EXPOSE 3100
CMD ["node", "deploy/load-secrets.mjs"]

FROM runtime AS mobile
COPY --from=mobile-deps /app ./
# Only the service; the Expo app under mobile-service/client is built by EAS, not here.
COPY mobile-service/package.json mobile-service/tsconfig.json ./mobile-service/
COPY mobile-service/src ./mobile-service/src
ENV APP_ENTRY=mobile-service/src/server.ts APP_CWD=mobile-service PORT=3103
USER svc
EXPOSE 3103
CMD ["node", "deploy/load-secrets.mjs"]
