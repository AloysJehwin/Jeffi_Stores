# Microservices plan: surface services + shared services

_Written 2026-10-10. Status: **proposal for review — no code changed yet.**_
_Based on a full scan of the current app: 182 pages, 561 API routes, 30 `src/lib` modules, 16 tenant schema files._

## 1. The model

Each **surface service** owns its frontend *and* backend for one audience (storefront, admin, business, …).
A small set of **shared services** does work several surfaces need and that talks to the outside world
(payments, notifications, AI). Surfaces call shared services; surfaces never call each other.

```
                 Traefik (host → service)
   ┌──────────┬──────────┬──────────┬──────┬───────┬──────────┐
 storefront  admin   business    docs   vault   platform      ← surface services (FE + BE)
   └──────────┴────┬─────┴──────────┴──────┴───────┴──────────┘
                   │ HTTP (sync) + Redis queue (async)
         ┌─────────┼──────────────┬───────────────┐
      payments  notifications    ai          sync-worker       ← shared services
         └─────────┴──────────────┴───────────────┘
                   │
     per-tenant Postgres (unchanged)  ·  control-plane Postgres  ·  Redis  ·  S3
```

**What does not change:** each store keeps its one database. There is no data migration, no cross-database
transaction, and no saga. Services share the database but each table group has exactly **one writer service**
(§5), enforced by per-service Postgres roles.

## 2. The services

### Surface services (frontend + backend)

| # | Service | Hosts | Pages / API taken from today's app | Size today |
|---|---|---|---|---|
| 1 | **storefront** | `{slug}.jeffistores.in`, `www-{slug}.`, custom domains, apex (flagship); `forms-{slug}.` | `(storefront)`, `(marketing)`, `(auth)`, `(portal)/forms`; public APIs: catalog, store-config, cart, checkout, orders (customer side), auth, account, subscriptions, reviews, support, on-store AI, track, email-events/unsubscribe | 37 pages, ~110 routes |
| 2 | **admin** (management) | `admin.`, `admin-{slug}.` | `(admin)` except `admin/ecom`; all `api/(admin)/admin/*` except `ecom`, `site-reachability`, `financial/payables/webhook`; the 26 admin-gated routes that live in `api/(public)` today (§6.1); staff portal (`/staff`) | ~95 pages, ~360 routes |
| 3 | **business** (B2B) | `business.`, `{slug}.business.` (and `/business/*` on store hosts → 301 to the business host) | `(business)/business`, `api/business/*`; its own copies of checkout/orders/account handlers, built from the shared `commerce` package | 26 pages, ~16 routes + shared handlers |
| 4 | **docs** | `invoice[-slug].`, `quotation[-slug].`, `purchaseorder[-slug].` | `(business)/{invoice,quotation,purchaseorder}/[token]`, `api/public/{invoice,quotation,purchaseorder}`; **plus the PDF renderer** (invoice, quotation, PO, packing slip, label, receipt) as an internal API the other services call | 3 pages, 6 routes + PDF API |
| 5 | **vault** | `vault.`, `vault-{slug}.` | `(vault)`, `api/vault/*` (handoff stays reachable on the store host via a Traefik path rule) | 3 pages, 6 routes |
| 6 | **platform** (SaaS control plane) | `ecom.jeffistores.in`, `certificate.` | `(ecom)`, `api/(ecom)`, `admin/ecom` operator pages + `api/admin/ecom` (16), `site-reachability`, `(portal)/certportal`, provisioning worker/reconcile/advance, migrations fan-out, settlement crons | ~22 pages, ~50 routes |

### Shared services (no UI)

| # | Service | Does | Taken from today's app | Called by |
|---|---|---|---|---|
| 7 | **payments** | Razorpay orders, verify, payment links, refunds; both Razorpay webhooks; RazorpayX payables webhook; Route transfers, wallet, settlements | `lib/payments/*`, `api/razorpay/*`, `api/webhooks/razorpay[/tenant]`, `admin/financial/payables/webhook`, `cron/{reconcile-settlements,retry-reversals,wallet-drift}`; SaaS subscription billing (`razorpay-subscriptions`) | storefront, business, admin (refunds, links), platform (SaaS billing) |
| 8 | **notifications** | Email (SES), WhatsApp + SMS (Twilio), templates, mail/message logs, OTP delivery, mailer + campaign dispatch, Twilio inbound webhook | `lib/email/*`, `shared/{whatsapp,sms,notify}.ts`, `campaigns/whatsapp-dispatch.ts`, `cron/dispatch-mailer`, `webhooks/twilio` | every service (fire-and-forget via queue) |
| 9 | **ai** | Already separate (`ai-platform/gateway` on the Razer): chat, embed, vision/OCR, caches | unchanged | storefront, admin, business |
| 10 | **sync-worker** | Scheduled and admin-triggered outbound syncs: Google Merchant, Amazon SP-API, Sheets import, Meta social posts, Delhivery status sync | `lib/{merchant,amazon,import,social}`, `internal/import/worker`, `admin/merchant/*sync`, `cron/publish-social-posts`, `admin/delhivery/sync-statuses` | admin (enqueue), crons |

**Kept as shared packages, not services** (they are in-request logic every surface needs, and a network hop would
only add latency): catalog/GST/pricing/selling units, order commit + inventory deduction + invoice numbering,
coupons/loyalty/referrals, Delhivery client (rate, EDD, labels), auth/sessions, tenancy. See §4.

## 3. How a request flows (examples)

- **Storefront checkout:** storefront → `payments` `POST /orders` (Razorpay order) → browser pays → Razorpay webhook
  → `payments` verifies, records `payments`, then commits the order using the `commerce` package (same DB, one
  transaction: order + stock + invoice number) → enqueues `order.placed` → `notifications` sends email/WhatsApp.
- **Admin refund:** admin → `payments` `POST /refunds` → `payments` writes refund + wallet → `notifications`.
- **Quotation → invoice:** stays inside **admin** (one transaction with `commerce`); PDF via `docs` `POST /render`.
- **Packing slip:** admin → `docs` `POST /render/packing-slip` → PDF bytes.
- **Owner signs up:** platform → `payments` (SaaS subscription) → webhook → platform provisioning.

## 4. Code layout: monorepo

npm workspaces (Turborepo for cached builds). One repo, one CI, many images.

```
apps/
  storefront/  admin/  business/  docs/  vault/  platform/      Next.js apps (own middleware, own routes)
services/
  payments/  notifications/  sync-worker/                        Node (Fastify) services
  ai-gateway/                                                    moved from ai-platform/ (unchanged)
packages/
  core/        db (getPool, tenant pools), tenant-context, redis, s3, logger, otel, rate-limit, cache-bus
  tenancy/     host resolution, tenant-registry, mTLS/CA, custom domains
  auth/        sessions, JWT, OTP verify, scopes, session binding, plan-gate
  catalog/     gst, pricing, selling units, site-controls, search
  commerce/    order commit/draft, checkout intents, inventory deduct, invoice numbering, coupons, loyalty, referrals, cart
  shipping/    Delhivery client, EDD, shipping rate, e-invoice, e-way bill
  clients/     typed clients for payments, notifications, docs, ai (+ internal service auth)
  ui/          components/ui + components/shared + the visitor pieces business reuses; contexts
  schema/      database/*.sql stays the single source of truth (pipeline unchanged)
```

Today's `src/lib` maps almost one-to-one onto these packages; the move is mechanical (path aliases change,
code does not).

## 5. Data ownership (one writer per table group)

All services connect to the same per-tenant DB, but with **their own Postgres role** granted write access only to
the tables they own (read access as needed). A write from the wrong service fails loudly instead of silently.

| Table group (schema file) | Writer | Readers |
|---|---|---|
| catalog (`catalog.sql`), reviews/wishlist (`reviews.sql`), settings (`settings.sql`) | admin (reviews/wishlist: storefront) | all |
| orders, order_items, returns, change requests, cart (`orders.sql`) | storefront, business (via `commerce`); admin (status, returns, manual orders via `commerce`); payments (commit on webhook via `commerce`) | all |
| inventory (`inventory.sql`) | `commerce` package only (from whichever service commits) + admin (GRN, adjustments) | admin |
| invoices, cash sales (`invoices.sql`), quotations/PO/RFQ (`quotations.sql`) | admin (business: RFQs only) | docs, business, storefront |
| payments, pending intents (`payments.sql`); control-plane money tables | payments | admin, platform |
| users, addresses (`users.sql`) | storefront, business (customers); admin (admins, service accounts) | all |
| auth sessions, otp (`auth.sql`) | auth package in each service | all |
| marketing, coupons, loyalty (`marketing.sql`), CRM (`crm.sql`), support | admin (coupon usage/loyalty ledger: `commerce`) | storefront, business |
| logs: email/message logs | notifications; page events: storefront; audit: admin | admin |
| merchant/amazon sync logs | sync-worker | admin |
| control plane (tenants, plans, provisioning, owners, KYC) | platform | all (read-only) |

`orders`, `inventory` and `invoices` have more than one writing *service*, but always through the one `commerce`
package — the rule lives in one place, and the role grants list exactly those services.

## 6. Things that must be fixed first (found in the scan)

### 6.1 Cross-surface couplings
| Coupling | Fix |
|---|---|
| ~26 admin-gated routes live under `/api/(public)`: `products/[id]` PATCH/DELETE, `brands`, `categories` (reorder, delete), `customers`, `gallery`, `upload`, `generate-image`, `razorpay/payment-link`, `orders/[id]/{refund,cancel-review,return-review}` | Move under `/api/admin/*`; keep the public paths as thin redirects for one release |
| Admin links to `/api/orders/:id/invoice` for PDFs | Point at `docs` `/render/invoice/:orderId` |
| Ecom dashboard calls `/api/admin/site-reachability` | Move to `/api/ecom/site-reachability` (platform) |
| Storefront `account/quotes` calls `/api/business/rfqs`; shared `CheckoutReviewPage` calls `/api/business/discount-preview` | The storefront gets its own `/api/rfqs` handler from the shared code; discount preview moves into `commerce` |
| Product pages call `/api/vault/{owned,handoff}` | `owned` → storefront handler; `handoff` stays a storefront route that redirects to vault (as today) |
| `/business/*` served on store hosts | 301 to the business host |
| Cron jobs call `/api/admin/*` (delhivery, merchant, amazon) and `merchant_sync`/`amazon_sync` are missing from `CRON_JOBS` | Move to sync-worker; register them; each service owns its CronJobs |

### 6.2 Process-local state that breaks with several services
| State | Fix |
|---|---|
| Rate limiter falls back to an in-memory map | Redis-only (`core/rate-limit`), fail-open with an alert |
| Settings/plan/host TTL caches (`site-controls`, `plan-gate`, `host-resolution`, delivery settings, offers) go stale when admin edits | `core/cache-bus`: Redis pub/sub `cache:invalidate:{tenant}:{key}`; admin publishes on every settings write; every service subscribes |
| ISR + `revalidateTag`/`revalidatePath` (13 call sites) only clear the local Next cache | Same bus: admin publishes `revalidate:{tenant}:{tag}`; storefront/business/docs revalidate locally |
| In-process cron (`IN_PROCESS_CRON`) | Already off on k8s; each service gets its own CronJobs from a split `CRON_JOBS` registry |
| Admin SSE events | Already Redis pub/sub — keep, scoped to admin |
| AI circuit breaker, token caches (Amazon LWA, Sheets, e-invoice) | Fine per process |

## 7. Service-to-service rules

- **Sync calls:** HTTP inside the cluster (`http://payments.platform.svc`), typed clients in `packages/clients`,
  timeouts + retries with **idempotency keys** on every mutating call (`Idempotency-Key` header, stored 24 h).
- **Async:** BullMQ on the existing Redis (already proven in the AI gateway). Queues: `notify`, `sync`, `events`.
- **Auth between services:** short-lived HMAC token carrying `{service, tenantId, exp}`; NetworkPolicy lets only
  surface namespaces reach shared services.
- **Tenant context:** every call carries `x-tenant-id`; the callee loads the tenant from the control plane exactly
  as middleware does today.
- **Tracing:** `traceparent` propagates automatically (OTel fetch instrumentation); each service reports its own
  `OTEL_SERVICE_NAME`, so Coroot shows the real service map.

## 8. Per-plan layout (provisioning)

Every surface already resolves the tenant from the host, so one deployment can serve many stores. That gives a
cheap layout for small plans and full isolation for large ones:

| Plan | storefront | admin | business | docs / vault | Shared services |
|---|---|---|---|---|---|
| Basic | **shared pool** | shared pool | shared pool | shared pool | platform-level |
| Growth | **own** | **own** | shared pool | shared pool | platform-level |
| Pro | own (HPA 2→3) | own | own | shared pool | platform-level |
| Enterprise | own (HPA 2→5) | own | own | own | platform-level (dedicated worker queue) |

- "Shared pool" = one platform deployment per surface serving every store on that plan (namespace `pool`).
- Memory per store: Basic ≈ 0 extra pods; Growth ≈ 2 pods (~0.6 GB, smaller images than today's ~450 MB);
  Pro ≈ 3–4; Enterprise ≈ 5–8. This keeps Basic pricing intact.
- `tiers.ts` grows a `surfaces` map per plan; `tenant-workload.ts` renders one Deployment/Service/IngressRoute per
  owned surface and routes the rest of the hosts to the pool. Plan changes move hosts between pool and own
  deployments with no downtime (new pods Ready → route switch → old pods drained), the same pattern as the
  `storefront` → slug rename.

## 9. Phases

Each phase ships on its own, keeps every store live, and has a one-step rollback (route the hosts back to the
current app, which keeps running until phase 6).

| Phase | Work | Effort | Rollback |
|---|---|---|---|
| **0. Prepare** | Monorepo + packages (mechanical move); fix §6.1 couplings and §6.2 state; split `CRON_JOBS` per service; per-service Postgres roles (log-only first) | 1.5–2 wk | Revert commits; still one app |
| **1. notifications** | Queue + worker; every `send*` becomes `notify.enqueue()`; Twilio webhook moves | 1 wk | Flag `NOTIFY_INLINE=true` sends in-process again |
| **2. payments** | Razorpay routes + both webhooks + refunds + settlements; idempotency store; split the 850-line webhook into handlers | 2 wk | Point the Razorpay webhook URLs and `/api/razorpay/*` route back to the app |
| **3. docs, vault, platform** | The three least-coupled surfaces become their own apps | 2 wk | IngressRoute per host back to the app |
| **4. business, then admin, then storefront** | Split the big three; admin last-but-one because it has the most routes, storefront last because it carries the revenue | 3 wk | Same, per host |
| **5. sync-worker + per-plan layout** | Extract syncs; provisioner renders per-plan surfaces and the shared pool; migrate the existing test store | 1.5 wk | Tier map back to "own everything" |
| **6. Retire the monolith** | Delete `src/app` remnants; enforce Postgres role grants | 0.5 wk | — |

**Total: about 11–12 weeks** for one developer, with visible wins from phase 1.

## 10. Verification per phase

- Contract tests for every shared-service API (request/response schemas in `packages/clients`).
- The existing 11.8k vitest suite keeps passing at each step (tests move with their code).
- **Shadow traffic** before each route flip: mirror a sample of real requests to the new service and compare
  status + body (Traefik mirroring), then flip one tenant (test store) before the flagship.
- k6 shopper test against the storefront after phase 4; HPA must still scale.
- Payments: replay recorded Razorpay webhook payloads (captured, failed, refund, transfer) against the new service
  in a staging tenant; reconcile totals with the old path for one week.
- Coroot service map shows the expected edges only (surface → shared service, never surface → surface).

## 11. Costs and risks

| Item | Impact |
|---|---|
| Core node memory | 4–6 extra platform deployments (pools + shared services) ≈ +1.5–2 GB. The core t4g.large (8 GB, 67% used) will need **t4g.xlarge** or a second node — which needs the vCPU quota increase. |
| Build time | Six Next.js builds instead of one; Turborepo caching keeps unchanged apps from rebuilding. The Mac build path needs more disk. |
| Payments correctness | Highest-risk phase: idempotency keys, webhook replays, a week of reconciliation before cut-over. |
| Cache staleness | Covered by the cache bus; verified by editing a setting in admin and checking every surface within 2 s. |
| Operations | More services to watch; each gets a `/readyz`, an ai_health-style synthetic check, and Coroot alerts. |

## 12. Decisions needed

1. **Basic plan on shared pools** (recommended) or one pod per store as today?
2. **Shipping** as a package (recommended now) or a separate service later?
3. **Monorepo tool:** npm workspaces + Turborepo (recommended) or Nx?
4. **Start date:** before or after the vCPU quota is approved? Phases 0–2 fit on the current core node; phases
   3–5 need more capacity.

---

## Addendum (2026-10-13): first services shipped — messaging, documents, public API

Status: **built and committed** (see `git log` for `messaging-service`, `document-service`, `public-api-service`).
Names/locations differ from the proposal above; this addendum is authoritative for them.

| Proposal above | Shipped as | Notes |
|---|---|---|
| `services/notifications` (internal) | **`messaging-service/`** (top-level) | SES email, Twilio SMS/WhatsApp. Reachable externally **through the gateway** with an API key, and internally from the monolith with `internal=true` claims (cost price, no margin). |
| `apps/docs` renderer (`/render`) | **`document-service/`** (top-level) | pdfkit renderer for invoice/quotation/receipt/packing-slip/label/PO, 5 layouts, server-side GST split, per-tenant numbering, S3 + token viewer. |
| — | **`public-api-service/`** (top-level) | `public.jeffistores.in`. Bearer API keys (sha256 in control-plane `api_keys`), scopes + `tenants.service_types` gating, per-key rate limit, Redis idempotency, HMAC proxy to the two services, OpenAPI at `/docs`. |
| `packages/clients` etc. | **`packages/{api-contracts,service-auth,pricing,wallet,gst}`** | zod contracts drive validation + OpenAPI; HMAC token has `{service, tenantId, tenantSlug, apiKeyId?, internal?, exp}`. |

- **Billing**: prepaid tenant wallet (`tenant_wallets` / `wallet_ledger`, control plane). Public price = provider cost × 1.4 (`PUBLIC_MARGIN`), SMS/WhatsApp trued-up from the Twilio status callback. Category `document` added.
- **Service types**: `tenants.service_types text[]` (`store | messaging | documents`). `plans.product = 'services'` (slug `services`, tier 0, ₹0) for API-only workspaces, which are created `active` straight from onboarding with **no provisioning**; `reconcileOrphanedTenants` ignores them. Adding a store later upgrades the **same tenant row** (`upgradeTenantToStore`), so the wallet is shared by construction.
- **Monolith cut-over**: `MESSAGING_INLINE` (default `true`). Set `false` to route `sendAuditedMail` (no cc/bcc/attachments), `sendSMS`, and WhatsApp `sendTemplate` through messaging-service at cost; `email_logs`/`message_logs` keep being written.
- **Dev ports**: public-api 3100, messaging 3101, documents 3102. DBs on the local Postgres: `jeffi_messaging`, `jeffi_documents` (`database/messaging/`, `database/documents/`).
- **Still per the original plan**: queue (BullMQ) for batches, k8s deployments + Traefik host rule for `public.`, moving the Next app into `apps/`, payments/sync-worker services.
