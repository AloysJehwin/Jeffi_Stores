# Jeffi Stores — Comprehensive Audit Report
**Date:** 2026-06-18  
**Branch:** feature-business  
**Scope:** 26-topic audit covering security, quality, testing, and reliability  
**Sources:** Direct source reading + 3 specialist agents (security, reliability, architecture/ops)

---

## Risk Summary

| Level | Count | Key Topics |
|-------|-------|--------|
| CRITICAL | 2 | Testing (complete absence), Concurrency race conditions |
| HIGH | 9 | Admin rate limit gap, RAZORPAY_KEY_SECRET guard, RDS `rejectUnauthorized: false`, npm vulnerabilities, no retry/circuit breakers, pool error silencing, no caching, no DR plan, RTO/RPO undefined |
| MEDIUM | 8 | shippingAddress z.any(), JWT revocation, createSessionToken dead code, DPDPA compliance gaps, audit log scope, ADR gaps, order number collision, ARIA/accessibility |
| LOW | 4 | notes field unvalidated length, cookie domain breadth, CSP missing upgrade-insecure-requests, feed secret optional |

---

## 1. Input Sanitization and Injection Prevention

**Risk: LOW–MEDIUM**

All database queries use parameterized `$1, $2, ...` placeholders via `node-postgres` — no raw string concatenation found anywhere. `parseBody()` in `src/lib/validate.ts` wraps every mutating API handler with Zod schemas. The Google Merchant feed (`src/app/api/feed/google/route.ts`) correctly escapes XML via `escapeXml()`. Next.js React renderer handles JSX output escaping.

**Gaps:**
- `shippingAddress: z.any().optional()` in `src/app/api/orders/create/route.ts:16` — the address object is never schema-validated. Individual fields are accessed by key and passed directly to `INSERT INTO addresses (...)` at line 197–210. Unexpected types reach the DB.
- `notes: z.string().nullish()` at line 17 has no `max()` constraint — unbounded string stored into `orders.notes`.

**Recommendations:**
1. Replace `z.any()` with a typed `AddressSchema` (fullName, phone, addressLine1, city, state, postalCode with zIndianPin, country)
2. Add `.max(500)` to the notes field

---

## 2. Authentication, Authorization, Roles, and Permissions

**Risk: HIGH**

Three-portal JWT architecture with type segregation:

| Token | Cookie | `payload.type` check |
|-------|--------|----------------------|
| Customer | `auth_token` | `=== 'customer'` |
| Business | `business_auth_token` | `=== 'business'` |
| Admin | `admin_token` | `adminId` field |

Cross-portal confusion prevented by `X-Auth-Portal: business` header in `authenticateAnyUser()`. Admin RBAC via `requireAdminScope()` + `hasScope()` + `getScopeForPath()`. mTLS enforced: `x-client-cert-cn` header validated against `authCertCN` in JWT.

**Critical gaps:**
- **Admin login and MFA routes receive zero rate limiting.** Middleware applies `applyRateLimit` only on non-admin paths (`if (!isAdminApiPath && ...)` in `middleware.ts:54`). `/api/admin/login`, `/api/admin/mfa/verify`, and `/api/admin/mfa/enroll-*` are all in `publicApiPaths` but have no TIERS entry in `src/lib/rate-limit.ts`. A credential stuffing loop against admin login is completely unthrottled.
- **`x-forwarded-host` trusted without allowlist validation** in `buildRedirectUrl` (`middleware.ts:27–36`) — enables open redirects if the load balancer passes this header unfiltered.
- **`approvalStatus` check for business users** is only at middleware redirect level, not per-API-route. A business user whose status changes post-login stays valid until 8-hour token expiry.
- No token revocation list — compromised tokens remain valid until expiry.

**Recommendations:**
1. Add TIERS entries to `src/lib/rate-limit.ts`: `/api/admin/login` → 5/60s, `/api/admin/mfa/` → 10/60s
2. Apply rate limiting before the `publicApiPaths` bypass for admin auth routes
3. Validate `x-forwarded-host` against an explicit allowlist (`['jeffistores.in', 'admin.jeffistores.in', 'business.jeffistores.in']`)
4. Implement progressive lockout: 5 failed admin login attempts → 15-min lockout via `admins.failed_login_count`

---

## 3. Session Management and Token Expiry

**Risk: MEDIUM**

- JWT expiry: `8h` — consistent between `JWT_EXPIRES_IN` and cookie `maxAge = JWT_MAX_AGE_S` in `src/lib/jwt.ts:14–15`
- MFA ticket TTL: 5 minutes — correctly short-lived
- Cookies: `httpOnly: true`, `secure` in production, `sameSite: 'lax'`

**Gaps:**
- **`createSessionToken` dead code in `src/lib/auth.ts:118–129`** — returns a plain JS object with a millisecond `exp` field, not a JWT. Not cryptographically verified. Risk of accidental reuse in future code.
- **Cookie domain is `.jeffistores.in` (all subdomains)** — admin token sent to every subdomain. Mitigated by `httpOnly`, but increases blast radius.
- No sliding-window session renewal — users are hard-logged-out at 8h regardless of activity
- No server-side token revocation — compromised tokens live to expiry

**Recommendations:**
1. Delete `createSessionToken` and `isSessionValid` from `src/lib/auth.ts` — the JWT system via `generateToken` is the authoritative path
2. Implement Redis-backed JWT blocklist keyed on `jti` for revocation; check in `verifyToken()`
3. Consider reducing admin JWT to 4h with sliding refresh on activity

---

## 4. Secrets Management

**Risk: HIGH**

`JWT_SECRET` and `MFA_ENCRYPTION_KEY` have startup-time validation (throw if missing). MFA uses AES-256-GCM with random 12-byte IV — correct.

**Critical gap:**
- **`RAZORPAY_KEY_SECRET` has no startup guard** — accessed with `!` non-null assertion at `src/app/api/razorpay/verify/route.ts:44`. If absent at runtime, HMAC call uses `undefined` and silently accepts any payment signature.

**Other gaps:**
- `CRON_SECRET` has no startup validation
- No secrets scanning in CI (no trufflesecurity/trufflehog step)
- Google service account JSON key file (`jeffi-stores-76e9ecaecdd6.json`) referenced in `.env.example` — confirm in `.gitignore`
- Razorpay webhook handler (if it exists) must verify `X-Razorpay-Signature` using `RAZORPAY_WEBHOOK_SECRET`

**Recommendations:**
1. Add startup guard: `if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('RAZORPAY_KEY_SECRET is not set')` in `src/lib/razorpay.ts`
2. Add same guard for `CRON_SECRET`
3. Add `trufflesecurity/trufflehog-actions-scan` to CI
4. Run `git log --all --full-history -- '**/*.json' | grep jeffi-stores` to confirm no key file committed

---

## 5. HTTPS/TLS Configuration and Certificate Rotation

**Risk: HIGH**

HSTS set correctly in middleware: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. mTLS admin path enforced via `x-client-cert-cn`. Certificate revocation checked against `admin_certificates` table.

**Gaps:**
- **`rejectUnauthorized: false` fallback** when `certs/global-bundle.pem` is missing (`src/lib/db.ts:47`) — silently disables TLS certificate verification for RDS. Should fail hard, not silently degrade.
- **IAM auth path also disables cert verification** (`src/lib/db.ts:38`: `ssl: { rejectUnauthorized: false }`) — protects credentials but leaves the TLS connection open to MitM within the VPC.
- No `upgrade-insecure-requests` in CSP (`next.config.js:9–21`)

**Recommendations:**
1. Remove the `rejectUnauthorized: false` fallback — throw at startup if cert bundle missing:
   ```ts
   if (!fs.existsSync(certPath)) throw new Error('RDS CA bundle missing at certs/global-bundle.pem')
   config.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
   ```
2. Apply the same CA bundle to the IAM auth path
3. Add `upgrade-insecure-requests` to CSP in `next.config.js`

---

## 6. Rate Limiting and Abuse Prevention

**Risk: HIGH**

Rate limiting implemented in `src/lib/rate-limit.ts` with Upstash Redis primary and in-memory `Map` fallback. Tiered by path:

| Path | Limit | Window |
|------|-------|--------|
| `/api/auth/send-otp` | 5 | 60s |
| `/api/auth/login` | 10 | 60s |
| `/api/auth/signup` | 5 | 60s |
| `/api/orders/create` | 10 | 60s |
| `/api/webhooks/` | 200 | 10s |
| `/api/` (default) | 60 | 10s |

**Critical gaps:**
- Admin login, admin MFA, and all admin API paths are **completely exempt** from rate limiting (see section 2)
- In-memory fallback is per-process, per-instance — effective limit multiplies by instance count on rolling deploys. No warning or hard failure when Redis is unavailable in production.
- Webhook limit of 200/10s is very high — allows replay flood

**Recommendations:**
1. Add TIERS entries for admin auth paths (5/60s for login, 10/60s for MFA)
2. Make Upstash Redis required in production — fail startup if `UPSTASH_REDIS_REST_URL` not set
3. Reduce webhook tier to 30/10s

---

## 7. Dependency Scanning and Vulnerability Patching

**Risk: HIGH**

`npm audit` output (run 2026-06-18): **38 vulnerabilities — 25 moderate, 12 high, 1 critical** — all in `node-tar` via `@mapbox/node-pre-gyp` (transitive dev dependency). `npm audit fix` is available.

Additional observations from `package.json`:
- `next: ^14.0.4` — Next.js 14.0.x had SSRF/path traversal CVEs fixed in 14.1.x–14.2.x. Run `npm list next` to confirm resolved version is ≥14.2.15.
- **`jsonwebtoken` is in dependencies but unused** — all JWT operations use `jose`. Dead dependency increases attack surface.
- No `npm audit`, Snyk, or Dependabot configuration in CI.

**Recommendations:**
1. `npm audit fix` immediately
2. `npm list next` — if <14.2.15, run `npm install next@latest` within the `^14` range
3. Remove `jsonwebtoken` and `@types/jsonwebtoken` from `package.json`
4. Add `npm audit --audit-level=high` to CI (fail build on high+)
5. Add `.github/dependabot.yml` for weekly automated PR updates

---

## 8. Multi-Tenancy and Data Isolation

**Risk: LOW**

Three distinct portals isolated at JWT `payload.type`, middleware subdomain routing, and `X-Auth-Portal` header enforcement. Business users additionally filtered by `approvalStatus`. All DB queries scope by `user_id` or `admin_id`.

**Recommendation:** Once a test framework exists, add integration tests verifying customer tokens cannot reach business/admin API routes.

---

## 9. PII Handling, Data Retention, and Deletion Policies

**Risk: MEDIUM**

PII stored: name, email, phone, addresses, order history, cart, wishlist, `customer_activity_log`. `shipping_address_snapshot` JSON persists in orders indefinitely.

No data retention policy documented. No account deletion endpoint found. No automated purge jobs.

**Recommendations:**
1. Document retention policy: orders (7 years for tax/GST), activity logs (1–2 years), carts (90 days)
2. Implement account deletion endpoint: anonymize PII in orders, hard-delete addresses/wishlist/cart/activity log
3. Schedule automated cart cleanup for carts abandoned >90 days

---

## 10. Regulatory Compliance (GDPR, DPDPA)

**Risk: MEDIUM**

Primary applicable regulation is India's **Digital Personal Data Protection Act (DPDPA) 2023**. EU/UK customers may also trigger GDPR.

Current state: no cookie consent mechanism, no privacy policy page (`/privacy`), no data export endpoint, no DPA infrastructure, no right-to-erasure implementation.

**Recommendations:**
1. Confirm whether EU customers can transact — if yes, add cookie consent banner
2. Add `/privacy` policy page linked in footer
3. Implement data export endpoint (DPDPA right to access)
4. Implement account deletion (DPDPA right to erasure) — see section 9

---

## 11. Audit Trails and Tamper-Evident Logging

**Risk: HIGH**

Two audit systems in parallel:

| System | Scope | Storage |
|--------|-------|---------|
| `logActivity()` | 32 customer event kinds | PostgreSQL `customer_activity_log` |
| DB session variable `audit.admin_id` | Admin mutations (INSERT/UPDATE/DELETE) | PostgreSQL triggers |

**Critical gap:**
```ts
// src/lib/db.ts
pool.on('error', () => {}) // completely silent
```
Pool errors (connection drops, auth failures, SSL errors) disappear without trace. No logging, no metric, no alert.

**Other gaps:**
- Customer activity log has no tamper protection — admin with DB access can `DELETE` entries
- Admin mutation audit relies on DB triggers — queries bypassing `withTransaction()` won't have `audit.admin_id` set
- No append-only log export to off-instance storage (S3, CloudWatch Logs)
- `logActivity()` for admin actions (product edits, order status changes) does not exist — only DB-trigger level

**Recommendations:**
1. Replace `pool.on('error', () => {})` with `pool.on('error', (err) => console.error('[pool]', err.message, err.code))`
2. Ship audit logs to CloudWatch Logs for tamper-evident off-instance storage
3. Add `logActivity()` calls for admin mutations (product edits, order status changes)

---

## 12–16. Testing (Unit, Integration, E2E, Regression, Load, Chaos, Coverage)

**Risk: CRITICAL**

**Zero test files exist in the entire codebase.**

Confirmed:
```bash
find . -name "*.test.*" -o -name "*.spec.*"  # 0 results
ls jest.config* vitest.config* playwright.config*  # all "No such file"
# package.json has no "test" script
```

The CI pipeline has: lint → typecheck → build → smoke-test (HTTP 200 check). No test job. No coverage measurement. No load testing tooling. No chaos engineering practices.

Known single points of failure with no resilience tests:
- RDS: no Multi-AZ, no read replica documented
- Upstash Redis: rate limit reverts to per-process in-memory on failure  
- SES: fire-and-forget silent failure
- Delhivery API: shipping quote failure returns `0` silently

**Recommendations (priority order):**
1. Install Vitest: `npm install -D vitest @vitest/coverage-v8`
2. Write unit tests first — pure logic with no I/O:
   - GST calculation (`src/lib/gst.ts`)
   - Rate limit tier matching (`src/lib/rate-limit.ts`)
   - Coupon discount logic (`src/app/api/orders/create/route.ts:119–158`)
3. Install Playwright: `npm install -D @playwright/test`
4. E2E: checkout flow, admin login, product add
5. Add `test` job to CI between `typecheck` and `build`
6. Set coverage threshold at 70% once tests exist, increase quarterly
7. Run k6 baseline load test against the 20-connection pool ceiling before any traffic campaigns
8. Test the Upstash Redis unavailability scenario — verify graceful degradation

---

## 17. Code Review Process and Standards

**Risk: HIGH**

CI runs lint + typecheck on PRs. No `CODEOWNERS` file. No PR template (`.github/pull_request_template.md` absent). No branch protection rules enforced beyond social convention. Any contributor with push access can merge to main without review.

**Recommendations:**
1. Add `.github/pull_request_template.md` with checklist: tests, migrations, env vars, breaking changes, accessibility
2. Add `.github/CODEOWNERS` — require `@AloysJehwin` review for `src/lib/`, `database/`, `.github/workflows/`
3. Enable GitHub branch protection on `main`: require 1 approval, require CI green, prohibit force-push and direct commits

---

## 18. Error Handling and Graceful Degradation

**Risk: HIGH**

All API routes have top-level `try/catch` returning generic `500` — no stack traces leak to clients. Correct. Fire-and-forget used for non-critical side effects.

**Gaps:**
- Every `catch` block swallows the error variable entirely — operators have no visibility into failures
- `quoteShipping` failure defaults to `0` shipping cost silently — financial miscalculation
- `createDraftInvoice` failure is silently swallowed — accounting artifact lost
- `pool.on('error', () => {})` — see section 11
- Razorpay verify surfaces `error.message` to client — may leak internal SDK identifiers

**Recommendations:**
1. Replace all `catch { }` with `catch (err) { console.error('[route]', err) }` at minimum
2. For shipping: surface a "shipping unavailable" error to the user rather than charging ₹0
3. For `createDraftInvoice`: `.catch(err => logger.warn('invoice_draft_failed', { orderId, err }))`
4. Adopt a structured logger (Pino) and ship to CloudWatch

---

## 19. Retry Logic with Backoff and Idempotency

**Risk: HIGH**

No retry library (`p-retry`, `axios-retry`) installed. No exponential-backoff retry loops for any external call: Razorpay, Delhivery, SES.

**Critical gap — Razorpay duplicate order:**
`razorpay.orders.create` in `src/app/api/razorpay/create-order/route.ts:85,135` has no idempotency key. A network timeout that retries the call (manually or via any future retry layer) silently creates a duplicate Razorpay order.

**Critical gap — draft token expiry after payment captured:**
Draft token TTL is 600 seconds. If a user's checkout takes longer, the token expires and `verifyRoute` returns `400 'Invalid or expired checkout session'` — after money has already been captured by Razorpay. No recovery path offered.

**Recommendations:**
1. Add receipt deduplication: before `razorpay.orders.create`, query `payments` for existing pending payment with same user+amount within a short window
2. Wrap Razorpay API calls in 2-retry backoff (200ms / 400ms)
3. Extend draft token TTL or implement a server-side checkout session table that survives the JWT window
4. Add a Razorpay webhook handler as the authoritative payment confirmation path (client-side verify is convenience; webhook is the safety net)

---

## 20. Circuit Breakers and Fallback Behavior

**Risk: HIGH**

No circuit breaker library installed. No circuit breaker pattern implemented. If Razorpay hangs, each incoming checkout request holds a connection pool slot for the full HTTP timeout — under load, the 20-connection pool is exhausted by blocked requests.

**Additional gap:**
`quoteShipping` fetch has no timeout (`AbortSignal`): `src/lib/order-commit.ts:289–310`. A hung shipping-rate service holds the request open indefinitely.

`getRazorpayInstance()` creates a new SDK client on every call — no singleton.

**Recommendations:**
1. Add `signal: AbortSignal.timeout(4000)` to `quoteShipping` fetch
2. Memoize `getRazorpayInstance()` as a module-level singleton
3. Implement circuit breaker for Razorpay and Delhivery using `cockatiel` (TypeScript-native)
4. Add `/api/health` endpoint checking `SELECT 1` — enables load-balancer health checks

---

## 21. Concurrency Handling and Race Condition Prevention

**Risk: CRITICAL**

**Strong patterns:** Invoice finalization uses `SELECT ... FOR UPDATE` — correct. Payment recording uses `ON CONFLICT (transaction_id) DO NOTHING` — correct.

**Critical race conditions:**

**1. Order creation TOCTOU** (`src/app/api/orders/create/route.ts:45–58`):
The duplicate-order check runs outside the transaction. Two concurrent requests for the same user can both pass the check before either commits, creating two pending orders.

**2. Non-atomic cart increment** (`src/app/api/cart/route.ts:200–226`):
```ts
const existingItem = await queryOne('SELECT * FROM cart_items ...')
const newQuantity = Number(existingItem.quantity) + Number(quantity)
await query('UPDATE cart_items SET quantity = $1 ...', [newQuantity, ...])
```
Two concurrent add-to-cart calls both read `quantity=1`, both compute `newQuantity=2`, both write `2` — one increment is silently lost. Must be an atomic upsert:
```sql
INSERT INTO cart_items (..., quantity) VALUES (...)
ON CONFLICT (user_id, product_id, variant_id, sub_variant_id, buy_mode)
DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
```

**3. No stock reservation at checkout** — stock is only decremented at invoice finalization (an admin action). Between payment and finalization, the same stock can be sold to multiple concurrent buyers.

**4. Coupon times_used TOCTOU** — `validateCouponForUser` reads `times_used` outside the transaction that increments it. Under concurrent checkout for the same coupon, two users can both pass validation and both commit, exceeding the usage limit by one.

**Recommendations:**
1. Move duplicate-order check inside `withTransaction` using `SELECT ... FOR UPDATE SKIP LOCKED`
2. Replace cart read-then-write with atomic `INSERT ... ON CONFLICT DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`
3. Add stock reservation at `commitOrder` using `SELECT ... FOR UPDATE` + decrement check
4. Move coupon validation inside the transaction with `SELECT ... FOR UPDATE` on the coupon row
5. Add `UNIQUE` constraint on `orders.order_number` and handle violation with retry (new number)

---

## 22. Caching Strategy and Cache Invalidation

**Risk: HIGH**

**No application-level caching exists.** Upstash Redis is in the tech stack but used only for rate limiting — not for data caching.

Homepage (`src/app/page.tsx:9`): `export const dynamic = 'force-dynamic'` — every visitor triggers fresh DB queries.

`React.cache()` on `getProductBySlug` deduplicates within a single render pass only — zero cross-request caching.

No `Cache-Control` headers on product API responses. No ISR (`revalidate`) on product/category pages. No `next.config.js` cache handler.

Expensive uncached queries: full product catalog, category pages, Google Shopping feed (full catalog on every request), AI re-ranker.

**Recommendations (priority order):**
1. Cache Google Shopping feed in S3 or Redis with 6-hour TTL — highest priority, currently hits full DB scan on every request
2. Replace `force-dynamic` on homepage with `export const revalidate = 120`
3. Add `export const revalidate = 60` to product and category page components (ISR)
4. Add `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` to `/api/products/slug/[slug]` responses
5. Replace `React.cache()` on `getProductBySlug` with `unstable_cache` with product-slug tags for cross-request caching and tag-based invalidation on product update

---

## 23. RTO and RPO

**Risk: HIGH**

No RTO/RPO targets documented anywhere. Infrastructure assessment:

| Component | Current State | Estimated Recovery |
|-----------|---------------|-------------------|
| EC2 app server | Single t4g.micro, no ASG | 5–15 min manual |
| RDS database | Single instance, `multi_az: false` | 20–40 min restore |
| S3 assets | Multi-AZ by default | Near-zero |
| CloudFront | Global CDN | Near-zero |

RDS `deletion_protection: false` — database can be dropped with a single API call.
Service scheduled to stop at 22:00 IST daily — 13 hours/day intentionally unavailable.

**Recommendations:**
1. Define RTO target (e.g. <30 min) and RPO target (e.g. <24h data loss) in `docs/ops/rto-rpo.md`
2. Enable RDS deletion protection immediately: `aws rds modify-db-instance --db-instance-identifier jeffi-stores-db --deletion-protection`
3. Enable RDS Multi-AZ for <2-minute automated failover
4. Document the deliberate scheduled-downtime decision as an ADR (cost/availability tradeoff)

---

## 24. Disaster Recovery Plan

**Risk: HIGH**

No DR plan document exists. `deploy/maintenance.sh` is the closest operational runbook. `scripts/backup-live-db.sh` exists but no documented schedule, destination, or retention.

Additional risks:
- **S3 versioning disabled** (`versioning: disabled` in `aws-infrastructure.yaml`) — product images and invoices cannot be recovered if accidentally deleted
- **Redis `redis-data` Docker volume has no backup** — cart state and session data lost on any EC2 volume loss
- **SES still in sandbox mode** (`production_access: false`) — transactional emails (OTP, order confirmations) cannot reach unverified customer addresses. A denied production access request is on record.

**Recommendations:**
1. Enable S3 versioning on `jeffi-stores-bucket` — zero-cost, do today
2. Enable RDS deletion protection — do today
3. Re-file SES production access request (previous case was denied)
4. Write `docs/ops/disaster-recovery.md`: RDS restore procedure, EC2 rebuild, Redis data loss policy, S3 versioned restore
5. Schedule `scripts/backup-live-db.sh` as EC2 cron with output to a separate S3 bucket, document retention (30 days)
6. Add CloudWatch alarm on EC2 status checks and RDS `FreeStorageSpace`

---

## 25. Accessibility

**Risk: MEDIUM**

ARIA coverage across ~200+ component files:
- `aria-*` attributes: 34 files
- `role=` attributes: 9 files  
- `alt=` on images: 25 files

Strong points: wishlist button has `aria-label`, share button has `aria-label`, `<h1>` present on product pages, `<dl>/<dt>/<dd>` used correctly for product specs.

**Mechanical gaps found:**
- Quantity +/- buttons in cart: no `aria-label` — SVG icons with no accessible text
- Per-item "Save for later" / "Remove" buttons: no `aria-label` contextualizing which item — repeated identical labels for every cart row
- Loading spinners: no `role="status"` or `aria-label="Loading"`
- Decorative SVGs (stock status icons, delivery icons): missing `aria-hidden="true"`
- Coupon input: only `placeholder` attribute, no `<label>` — WCAG 1.3.1 failure
- No skip-navigation link at top of root layout
- No CI accessibility audit tooling (axe-core, pa11y, Lighthouse)

**Recommendations:**
1. `aria-label={`Decrease quantity for ${item.products.name}`}` on quantity buttons
2. `aria-label={`Save ${item.products.name} for later`}` on per-item action buttons
3. `role="status"` + `aria-label="Loading"` on spinner divs
4. `aria-hidden="true"` on all decorative SVGs
5. Replace coupon `placeholder` with a proper `<label htmlFor="coupon-input">`
6. Add skip-navigation link as first root layout element: `<a href="#main-content" className="sr-only focus:not-sr-only">Skip to main content</a>`
7. Add `@axe-core/playwright` to E2E tests once Playwright is set up

---

## 26. Architecture Diagrams and ADRs

**Risk: MEDIUM**

**ADRs:** Only 3 exist, all dated 2026-05-31, all AI/product-feature focused. All still show "Proposed" status despite ADR-0003 being implemented.

**Significant decisions with no ADR:**
- JWT auth model (vs NextAuth, session cookies), 8h TTL choice
- mTLS via API Gateway for admin panel
- PostgreSQL + pgvector as unified data + vector store
- Docker Compose on single EC2 (vs ECS/Fargate)
- Single-AZ deployment with scheduled stop/start (deliberate cost/availability tradeoff)
- Razorpay vendor selection, Delhivery as sole shipping provider
- E-invoice/E-way Bill deferred/blocked status
- Rate limiting exempt for admin paths

**Architecture diagrams:** None found. `deploy/aws/aws-infrastructure.yaml` contains traffic flow comments and partially compensates.

**Recommendations:**
1. Update ADR-0002 and ADR-0003 status from "Proposed" to "Accepted"
2. Create ADR-0004: Single-AZ deployment with scheduled downtime (documents cost/availability tradeoff)
3. Create ADR-0005: mTLS admin panel via API Gateway + Lambda proxy
4. Create ADR-0006: PostgreSQL + pgvector as unified store
5. Create ADR-0007: JWT authentication model
6. Add Mermaid infrastructure diagram to `README.md` (can be derived from `aws-infrastructure.yaml` in ~30 min)
7. Add ADR requirement to PR template: new ADR required for any AWS service change, auth model change, new external vendor integration

---

## Immediate Action Items (Priority Order)

| # | Priority | Action | Effort | Risk Mitigated |
|---|----------|--------|--------|----------------|
| 1 | P0 | `npm audit fix` | 15 min | 38 CVEs |
| 2 | P0 | `pool.on('error', () => {})` → add error logging | 5 min | Invisible pool failures |
| 3 | P0 | Add startup guard for `RAZORPAY_KEY_SECRET` | 5 min | Silent payment bypass |
| 4 | P0 | Enable RDS deletion protection via AWS CLI | 5 min | Accidental DB drop |
| 5 | P0 | Enable S3 versioning on `jeffi-stores-bucket` | 5 min | Accidental asset deletion |
| 6 | P0 | Re-file SES production access request | 15 min | Order emails/OTP failing |
| 7 | P1 | Add rate limiting to `/api/admin/login` and `/api/admin/mfa/*` | 30 min | Credential stuffing |
| 8 | P1 | Remove `rejectUnauthorized: false` fallback for RDS | 10 min | DB TLS MitM |
| 9 | P1 | Fix cart add-to-cart race: atomic upsert | 1 hr | Lost cart increments |
| 10 | P1 | Fix order creation TOCTOU: check inside transaction | 1 hr | Duplicate orders |
| 11 | P1 | Cache Google Shopping feed (`/api/feed/google`) | 2 hr | DB load spike |
| 12 | P1 | Install Vitest; write first tests for GST/coupon logic | 4 hr | Zero test coverage |
| 13 | P2 | Replace all `catch { }` with `catch (err) { console.error(...) }` | 1 hr | Silent failures |
| 14 | P2 | Add `signal: AbortSignal.timeout(4000)` to `quoteShipping` | 15 min | Hung requests |
| 15 | P2 | Add `npm audit --audit-level=high` to CI | 30 min | Future CVEs |
| 16 | P2 | `npm list next` + upgrade if <14.2.15 | 15 min | Next.js SSRF/path traversal |
| 17 | P2 | Remove unused `jsonwebtoken` package | 10 min | Attack surface |
| 18 | P2 | Move order number generation inside DB transaction | 1 hr | Collision 500 errors |
| 19 | P2 | Delete `createSessionToken` dead code | 5 min | Accidental reuse risk |
| 20 | P3 | Enable RDS Multi-AZ | 30 min config | 20–40 min RDS failure window |
| 21 | P3 | Add coupon validation inside transaction with FOR UPDATE | 1 hr | Limit-bypass race |
| 22 | P3 | Write `docs/ops/disaster-recovery.md` | 2 hr | No recovery procedure |
| 23 | P3 | Add `.github/pull_request_template.md` and `CODEOWNERS` | 30 min | Ungated merges |
| 24 | P3 | Add `revalidate = 120` to homepage, `revalidate = 60` to product pages | 1 hr | DB connection pressure |
| 25 | P4 | Fix ARIA labels on cart quantity buttons and per-item actions | 2 hr | Accessibility |
| 26 | P4 | Create ADR-0004 through ADR-0007 | 2 hr | Undocumented architecture |
