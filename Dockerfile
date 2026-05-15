FROM node:20-alpine AS base

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Builder ----
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Remove platform-specific SWC binaries — Next.js falls back to WASM compiler on Alpine
RUN find node_modules/@next -name "*.node" -delete 2>/dev/null || true
COPY . .

# Build the Next.js app in standalone mode
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"

ARG DATABASE_URL
ARG JWT_SECRET
ARG NEXT_PUBLIC_APP_URL
ARG SKIP_DB_CHECK
ENV DATABASE_URL=$DATABASE_URL
ENV JWT_SECRET=$JWT_SECRET
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV SKIP_DB_CHECK=$SKIP_DB_CHECK

RUN npm run build

# ---- Runner ----
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone server + static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy pdfkit + full dependency tree (serverExternalPackages not bundled by Next.js)
COPY --from=deps /app/node_modules/pdfkit ./node_modules/pdfkit
COPY --from=deps /app/node_modules/@noble ./node_modules/@noble
COPY --from=deps /app/node_modules/fontkit ./node_modules/fontkit
COPY --from=deps /app/node_modules/@swc ./node_modules/@swc
COPY --from=deps /app/node_modules/tslib ./node_modules/tslib
COPY --from=deps /app/node_modules/brotli ./node_modules/brotli
COPY --from=deps /app/node_modules/base64-js ./node_modules/base64-js
COPY --from=deps /app/node_modules/clone ./node_modules/clone
COPY --from=deps /app/node_modules/dfa ./node_modules/dfa
COPY --from=deps /app/node_modules/fast-deep-equal ./node_modules/fast-deep-equal
COPY --from=deps /app/node_modules/restructure ./node_modules/restructure
COPY --from=deps /app/node_modules/tiny-inflate ./node_modules/tiny-inflate
COPY --from=deps /app/node_modules/unicode-properties ./node_modules/unicode-properties
COPY --from=deps /app/node_modules/unicode-trie ./node_modules/unicode-trie
COPY --from=deps /app/node_modules/pako ./node_modules/pako
COPY --from=deps /app/node_modules/js-md5 ./node_modules/js-md5
COPY --from=deps /app/node_modules/linebreak ./node_modules/linebreak
COPY --from=deps /app/node_modules/png-js ./node_modules/png-js

# Copy qrcode + bwip-js (used for packing slip PDF QR and barcode generation)
COPY --from=deps /app/node_modules/qrcode ./node_modules/qrcode
COPY --from=deps /app/node_modules/pngjs ./node_modules/pngjs
COPY --from=deps /app/node_modules/dijkstrajs ./node_modules/dijkstrajs
COPY --from=deps /app/node_modules/bwip-js ./node_modules/bwip-js

# Copy database migration files
COPY --from=builder --chown=nextjs:nodejs /app/database ./database

# Copy pg module for migration runner
COPY --from=deps /app/node_modules/pg ./node_modules/pg
COPY --from=deps /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=deps /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=deps /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=deps /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=deps /app/node_modules/pg-connection-string ./node_modules/pg-connection-string

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
