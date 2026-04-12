FROM node:18-alpine AS base

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
COPY . .

# Build the Next.js app in standalone mode
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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

# Copy the Google service account key (will be overridden by Secrets Manager in prod)
# This is a fallback; prefer fetching from Secrets Manager at runtime
COPY --from=builder /app/jeffi-stores-76e9ecaecdd6.json ./jeffi-stores-76e9ecaecdd6.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
