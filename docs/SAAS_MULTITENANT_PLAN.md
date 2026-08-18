# Jeffi Stores → Multi-Tenant SaaS: Architecture Plan
> ⚠️ **SUPERSEDED (2026-08-18) — the "no code written yet" line below is NO LONGER TRUE.**
> The multi-tenant foundation and provisioning engine are **built and committed** on
> `feat/multitenant-foundation` (PR #425). For current state, read
> **`docs/SAAS_MULTITENANT_STATUS.md`**. Keep this file for design rationale and locked
> decisions only.

> Status: **Design / decisions locked (round 1).** No code written yet. Grounded in a full codebase survey (Aug 2026).

## Locked decisions (owner sign-off)

| # | Decision | Locked value | Notes |
|---|---|---|---|
| Isolation | Per-tenant DB | **`db.t4g.micro` provisioned RDS per tenant** (24/7) | Simplest hard isolation. Aurora Serverless idea dropped. Cost floor validated below — ₹4,999 clears it. |
| Payments rail | POBO | **Razorpay Route** for tenants (Stripe Connect ruled out — unavailable in India) | Route is an RBI-authorized PA: it holds/pools funds in *its* escrow and splits to linked accounts, so we never touch buyer→seller money → stays out of PA licensing scope. Verified against RBI circular + Stripe docs (§4). **NOT RazorpayX** (that = us pooling funds = PA scope). |
| Our own store | Razorpay | **`jeffistores.in` stays on plain Razorpay, NOT a tenant** | Kept separate. The `PaymentGateway` abstraction lets Razorpay-PG-for-us + Razorpay-Route-for-tenants coexist. |
| Seller-of-record | Legal invariant | **The tenant is always the merchant/seller-of-record to their end customer** | This is what keeps us out of RBI PA scope. If we ever became seller-of-record with tenants as mere suppliers, we'd fall *into* PA scope. Design invariant — do not violate. |
| Payout cadence | Settlement | **Weekly** payout to tenants; **daily = paid upgrade (~5% premium)** | |
| Principals | Multi-tenant users | **Restricted: one principal = exactly one tenant** | ⇒ `tenant_id` is a snapshotted session claim on `auth_sessions` (consistent with existing `role`/`scopes` snapshot). No per-request tenant switching for a logged-in user. |
| Basic price | Pricing | **₹4,999/mo** | ~55% gross margin at ~₹2,250 infra floor (calc in §2.5). Clears the "cost × 1.5" rule. |
| S3 | Storage | **Bucket-per-tenant** (`jeffi-tenant-{id}` or similar) | Owner's call for maximal isolation. ⚠️ AWS default limit 100 buckets/account — **must file a service-quota increase** (up to ~1,000) as a provisioning prerequisite, and revisit beyond that scale. |

---

## 0. What we have today (the honest starting point)

The app is a **single-tenant monolith**. Everything below is verified in code, not assumed:

| Layer | Today | File(s) |
|---|---|---|
| Routing | 100% **Host-header driven** in middleware. `admin.` / `business.` / `forms.` / `quotation.` / `invoice.` / `purchaseorder.` are string-prefix matched and rewritten to `/admin`, `/business`, … Subdomains are **app selectors, not tenant selectors.** No `next.config` rewrites. | `src/middleware.ts` (hostname L64, rewrites L98–248) |
| Auth | **Opaque revocable sessions** (32-byte token, SHA-256 stored in `auth_sessions`). `resolveSession()` is the single source of truth. 3 principal types: `admin` / `customer` / `business`. Cookie domain `.jeffistores.in` shared across all subdomains. | `src/lib/auth-sessions.ts`, `src/lib/jwt.ts`, `src/lib/cookie-domain.ts`, `database/auth.sql` |
| Permissions | Flat, **admin-only** scope list (43 keys, route→scope). `hasScope()` with `super_admin` bypass + write⇒read. **No plan tiers, no feature flags per tenant.** | `src/lib/scopes.ts` |
| Database | **One global `pg.Pool`** from one `DATABASE_URL` (or RDS IAM). ~127 tables, **zero `tenant_id`/`store_id` anywhere.** 438 files import `@/lib/db`. Plus 2 more singleton pools (RAG, admin-agent) and 1 Redis singleton. | `src/lib/db.ts`, `database/*.sql` |
| Store config | Single store: name, logo, GST, address, **single warehouse** (origin pin, pickup name, seller addr) — all scalar values in `site_settings` k/v via `getBusinessValues()`. | `src/lib/site-controls.ts` |
| Shipping | Delhivery via raw REST (no SDK). **One warehouse, one API key.** COD lifecycle `cod_pending→cod_collected→paid` per order. Quoted-vs-actual charge reconciliation **already built** (`delhivery_extra_charge`, `delhivery_billed_amount`). Return address hardcoded to Raipur/Chhattisgarh. | `src/lib/delhivery.ts`, `src/app/api/admin/orders/[id]/create-shipment/route.ts`, `src/app/api/admin/delhivery/sync-statuses/route.ts` |
| Payments | **Razorpay only**, one merchant account. Order→verify(HMAC)→webhook(HMAC) flow with idempotent double-commit guard (`pending_payment_intents`). Full refunds only. RazorpayX used for **outbound supplier A/P** (not marketplace). **No Stripe, no subscriptions/mandates.** | `src/lib/razorpay.ts`, `src/app/api/razorpay/*`, `src/app/api/webhooks/razorpay/route.ts`, `database/payments.sql` |
| Infra | **One EC2** (t4g.micro) blue/green on the same host, one Docker nginx proxying all subdomains to one `app_backend`. **No ALB, no autoscaling.** One RDS PG16, one public S3 bucket (`jeffi-stores-bucket`, prefix-namespaced). Dual mTLS for admin (nginx CA **and** API-GW v2 truststore). EventBridge starts/stops EC2+RDS daily (not 24/7). | `deploy/*`, `src/lib/s3.ts`, `deploy/aws-infrastructure.yaml` |
| Admin UI | `src/app/admin/` (40 sections). Nav array defined **inline in `src/app/admin/layout.tsx` L38–78**, filtered by `hasScope`. Icons in `AdminSidebarNav.tsx`. | `src/app/admin/layout.tsx`, `src/components/admin/AdminSidebarNav.tsx` |

**The single most important architectural fact:** the codebase has **zero tenant dimension**. Multi-tenancy is greenfield. With RDS-per-tenant, we get to *avoid* rewriting all 438 DB call sites with `WHERE tenant_id = ?` — the tenant boundary becomes **which database connection you hold**, not a column on every query. That is the biggest reason RDS-per-tenant is actually pragmatic here despite its cost.

---

## Two planes: Control Plane vs Tenant Plane

Everything in the PDF splits cleanly into two systems. Keeping them separate is the backbone of the whole design.

```
                          ┌─────────────────────────────────────────┐
                          │  CONTROL PLANE  (ecom.jeffistores.in)     │
                          │  + admin.jeffistores.in → "Ecom Store"    │
                          │  ─────────────────────────────────────    │
   Prospect / Owner ────► │  • Onboarding + plan selection            │
                          │  • Billing (Stripe Billing subscription)  │
                          │  • Provisioning engine (RDS/EC2/S3/DNS/CA) │
                          │  • Tenant Registry (source of truth)      │
                          │  • Monitoring / status / maintenance      │
                          │  • POBO settlement ledger                 │
                          └───────────────┬─────────────────────────┘
                                          │ provisions + configures
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  TENANT PLANE  (the existing app, now tenant-aware)                     │
   │                                                                        │
   │  {tenant}.jeffistores.in ─┐                                            │
   │  admin-{tenant}.jeffistores.in ─┤─► nginx/ALB ─► app fleet (Basic pool │
   │  invoice-{tenant}.jeffistores.in┘   host→tenant   OR dedicated per     │
   │                                     resolver      tier 2+) ─► that     │
   │                                                   tenant's own RDS     │
   └──────────────────────────────────────────────────────────────────────┘
```

- **Control plane** is a *new* surface. It is the "page controls, not page content" system you described — it owns tenants, plans, money, and AWS resources.
- **Tenant plane** is the app you already have, made tenant-aware primarily via a **request-scoped tenant context** that selects the right RDS pool + S3 prefix + branding.

The control plane's onboarding/billing UI can live at `ecom.jeffistores.in`, and the operational views (customers, instances, store status, billing) get added to the **existing** `admin.jeffistores.in` as a new "Ecom Store" nav group (Part 5). Same backend, two front doors.

---

## Part 1 — User onboarding, plans & feature tiering

### 1.1 The tenant addressing collision (must decide first)

Your current subdomains (`admin.`, `business.`, `invoice.`, …) are **app names**. The PDF proposes tenant subdomains like `{tenant}.jeffistores.in`, `admin-{tenant}.jeffistores.in`, `Invoice{tenant}.jeffistores.in`. These do **not** collide with the app-name subdomains as long as we adopt the pattern:

- Storefront: `{tenant}.jeffistores.in`
- Admin: `admin-{tenant}.jeffistores.in` (note: `admin-` prefix, not `admin.` — good, avoids collision)
- Invoice: `invoice-{tenant}.jeffistores.in` (recommend hyphen form; the PDF's `Invoice{tenant}` with no separator is ambiguous and breaks DNS readability)
- `www.{tenant}` → redirect to `{tenant}`

**Reserved words:** `admin`, `business`, `forms`, `www`, `ecom`, `invoice`, `quotation`, `purchaseorder`, `api` must be blacklisted as tenant slugs so `admin.jeffistores.in` (your platform admin) never collides with a tenant.

> **Cookie subtlety (from the restricted-principal decision):** today one cookie on `.jeffistores.in` is shared across all subdomains. With per-tenant subdomains, a browser could carry a tenant-A session cookie to tenant-B's host. The `tenant_id` session-claim check (§2.2) neutralizes this — a session is *rejected* if its snapshotted `tenant_id` ≠ the host-resolved tenant. So we can **keep the shared cookie domain** (no need to move to host-scoped cookies), and the claim check is what enforces isolation. Platform-admin cookies (`admin.jeffistores.in`) carry no `tenant_id` (or a sentinel) and are only honored on the platform-admin host.

The middleware host parser changes from "does hostname start with `admin.`?" to a **two-step resolver**:
1. Strip known app-prefixes (`admin-`, `invoice-`, `www.`) → derive `(app, tenantSlug)`.
2. Look up `tenantSlug` (or a custom domain) in the **Tenant Registry** → get `tenant_id`, plan, status, DB endpoint.

### 1.2 The four plans (feature tiering via the existing scope system)

You already have the perfect lever: **`ADMIN_SCOPES` (43 keys) + `hasScope()`**. Plan tiers become **a set of allowed scope keys per plan**, intersected with the admin user's own scopes. Nothing about the storefront is gated — *"even Basic gets the full storefront."* Only **admin-panel features** are tiered.

Proposed mapping (drawn from the real 43 scope keys + nav groups):

| Plan | Admin capability (scope groups enabled) | Rationale |
|---|---|---|
| **Basic** | Dashboard, Catalogue (products/categories/brands read+write), Sales (orders, customers, invoices), core Fulfilment (packing slips, labels), Settings (site controls, settings). **Full storefront.** | "Store front with all features + basic admin pages." |
| **Growth** (tier 2) | + Quotations, CRM, Tasks, Returns/Replacements, Coupons, Reviews & Review Forms, Inventory, Shelving, GST Compliance. | The B2B + retention feature set. |
| **Pro** (tier 3) | + Marketing (Mailer, Campaigns, Traffic analytics), Business Customers + RFQs (B2B portal), AI Agent + Agent Logs, Catalog Enrichment, Merchant Sync (Google/Amazon). | Growth marketing + AI + channel sync. |
| **Enterprise** (tier 4) | Everything + custom domain included, dedicated infra, priority support, higher AI/RAG quotas, Financial module, Service Accounts/API access. | Full platform. |

**Implementation:** a new `plan_features` config (control plane) maps `plan → allowed_scope_keys[]`. At tenant admin login, the effective scopes = `intersection(user.scopes, plan.allowed_scope_keys)`. Because `layout.tsx` already filters nav by `hasScope`, **gated features simply disappear from the sidebar** with near-zero UI work — we inject the plan filter into the existing filter at `layout.tsx` L80–84 and into `getScopeForPath()` enforcement in middleware. A blocked route returns an "upgrade your plan" page instead of 403.

> ⚠️ Gap to close first: several nav items (`crm`, `tasks`, `controls`, `shelving`, `campaigns`, `merchant-sync`, `returns`, `replacements`, `delhivery`) **piggyback on another feature's scope** (e.g. CRM uses `customers:read`). For clean tiering, give these their own scope keys so they can be individually enabled/disabled per plan. This is a small, self-contained refactor of `scopes.ts` and should be **step 1** of Part 1.

### 1.3 Pricing model (AWS cost + 50%)

Price = `(monthly AWS cost of that tenant's resources) × 1.5`, plus feature-tier premium. The dominant cost driver is **the dedicated RDS instance** (see Part 2 economics — this is where RDS-per-tenant hurts). Custom domain is a flat add-on (Part 5). Concrete cost table is in §2.5.

---

## Part 2 — Store architecture (infra)

**Decision (locked): every tenant gets its own RDS instance.** Below is the design plus an honest cost reckoning.

### 2.1 Tenant Registry (the new source of truth)

A **control-plane database** (separate from all tenant DBs) holds:

- `tenants` — id, slug, custom_domain, plan, status (`provisioning`/`active`/`suspended`/`terminated`), created_at
- `tenant_infra` — rds_endpoint, rds_instance_id, ec2_target (pool vs dedicated instance id), s3_prefix (or bucket), region, cloudfront_id, cert_arn
- `tenant_secrets_ref` — pointer to the tenant's Secrets Manager secret (per-tenant DB creds, Delhivery key, Razorpay/Stripe keys)
- `plans` / `plan_features` — plan→scope map + limits
- `subscriptions` / `invoices` / `settlement_ledger` (Part 4)

This registry is queried by the host→tenant resolver on **every request** (cached in Redis, TTL ~60s, invalidated on tenant change). It never holds tenant business data — only routing + billing metadata.

### 2.2 Request-scoped tenant context (the core code change)

Introduce `AsyncLocalStorage<TenantContext>` — the exact same pattern the codebase **already uses for audit context** in `db.ts` (L94–109). Middleware resolves the tenant from host, stashes `{ tenantId, rdsRef, s3Bucket }` into ALS. Then:

**Tenant identity on the session (LOCKED decision):** because one principal = exactly one tenant, `tenant_id` is added as a **snapshotted column on `auth_sessions`** and a field on `ResolvedSession` — set once at login, consistent with how `role`/`scopes`/`cert_cn` are already snapshotted (`auth-sessions.ts` L234). `resolveSession()` returns it; middleware cross-checks it against the host-resolved tenant and **rejects mismatches** (a session minted for tenant A can never be replayed against tenant B, even though the cookie domain is shared). This is the security backbone of the restriction.

- **`src/lib/db.ts`** `getPool()` becomes tenant-aware: instead of one module-global pool, a **`Map<tenantId, Pool>` registry** keyed by the ALS tenant. Same for `rag.ts` and `dynamic-tools.ts`.
- **`src/lib/s3.ts`** `BUCKET_NAME` resolves per-request from the tenant context (bucket-per-tenant — see §2.4).
- **`src/lib/site-controls.ts`** cache is re-keyed by tenant (currently a single global 30s cache — would leak across tenants otherwise).
- **`src/lib/redis.ts`** keys are namespaced `t:{tenantId}:…`.

**Why this is tractable:** because the DB boundary is the *connection*, the 438 `@/lib/db` call sites **don't change** — they call `query()` as before; `query()` just resolves the right pool from ALS. This is the single biggest reason RDS-per-tenant is less code churn than shared-DB + `tenant_id` columns.

**Pool-exhaustion risk:** N tenants × a pool each will blow past RDS `max_connections` and app memory. Mitigation: an **LRU pool registry** (evict idle tenant pools), small `max` per pool (e.g. 3–5), and — for the Basic pooled tier — RDS Proxy in front of the Basic RDS fleet.

### 2.3 Compute ladder (per the PDF)

| Tier | Compute | Notes |
|---|---|---|
| **Basic** | **Pooled EC2** — one shared app fleet serving all Basic tenants (tenant resolved per-request; DB isolation still holds because each Basic tenant has its own RDS). Grow the pool (add instances behind an ALB) as Basic tenants accumulate. | This is a change from today's single-EC2 blue/green: we need an **ALB with host-based routing** and an autoscaling group even for Basic, so the pool can scale. |
| **Growth (2)** | **Dedicated EC2** per tenant (or small dedicated ASG). | "Move the app to individual server from the 2nd plan." |
| **Pro (3)** | Larger dedicated instance + ALB + autoscaling. | |
| **Enterprise (4)** | Largest instance, multi-AZ RDS, ALB + autoscaling, optional multi-region. | |

**ALB is now required** (today there is none). Host-based listener rules route `{tenant}.jeffistores.in` → the correct target group (Basic pool TG, or a per-tenant TG for dedicated tiers). CloudFront stays as the edge; origin becomes the ALB instead of a single EC2 IP.

### 2.4 CNAME, TLS & the S3 question

- **DNS:** wildcard `*.jeffistores.in` → CloudFront/ALB already covers all `{tenant}.jeffistores.in` and `admin-{tenant}.` — **no per-tenant DNS record needed** for platform subdomains. Custom domains (Part 5) need per-domain records/ACM certs.
- **TLS:** a wildcard ACM/Let's Encrypt cert for `*.jeffistores.in` covers one level. Note `admin-{tenant}` and `{tenant}` are both single-level, so **one wildcard cert suffices** for all platform tenant hosts. Custom domains need their own certs (ACM + CloudFront SNI, or automated Let's Encrypt).
- **S3 (LOCKED: bucket-per-tenant):** each tenant gets its own bucket (`jeffi-tenant-{id}` or similar) for maximal isolation. **Provisioning prerequisite:** file an AWS **service-quota increase** for S3 buckets/account (default 100 → up to ~1,000); revisit the model past that scale (owner acknowledged, will increase later). Provisioning engine creates the bucket + tightened policy (no public-write; CloudFront OAC + signed URLs) at onboarding. `s3.ts` `BUCKET_NAME` moves from a single env default to a **per-request value resolved from the tenant context** (the `S3_KEY_PREFIX` hook is no longer needed for isolation but can stay for internal namespacing). Note: this makes `s3.ts` tenant-aware in the same way `db.ts` becomes tenant-aware — both resolve their target from the `TenantContext` ALS.
- **mTLS / CA:** admin surfaces stay mTLS-gated. Simplest: keep **one platform CA**, issue per-tenant admin client certs from it (cert CN carries tenant). The dual enforcement (nginx CA + API-GW v2 truststore) generalizes — the truststore stays the platform CA; the app maps cert CN → tenant admin. A CA-per-tenant model is possible but is real ops burden and probably overkill until an Enterprise customer demands it.

### 2.5 The cost reality (flagging this honestly)

**RDS-per-tenant is the expensive choice, and at low volume it can invert your margins.** Rough us-east-1 monthly, always-on:

- `db.t4g.micro` ≈ **$12–15/mo** each (the smallest sane RDS). 100 Basic tenants = **$1,200–1,500/mo just in idle DB**, before EC2/ALB/S3/data transfer.
- Your current cost trick — **EventBridge stops EC2+RDS daily** — does **not** translate to a SaaS: you can't stop a paying customer's DB overnight. So per-tenant RDS is 24/7.
- The "AWS cost × 1.5" pricing means Basic must be priced to cover ≥ ~$18–22/mo/tenant of DB alone. If that's above your target Basic price, the margin promise breaks **on the DB line specifically.**

**LOCKED: `db.t4g.micro` provisioned per tenant, 24/7.** Validated cost floor (us-east-1, ₹88/USD):

| Line | USD/mo | Note |
|---|---|---|
| RDS `db.t4g.micro` (24/7) | 13.5 | 53% of infra cost — the number to watch |
| RDS storage 20GB gp3 | 2.3 | |
| EC2 pooled share (Basic) | 4.5 | amortized ~5–6 Basic tenants per pooled `t4g.small` |
| ALB share | 1.8 | |
| S3 + CloudFront + egress | 2.3 | |
| RDS backups | 1.2 | |
| **Total** | **~$25.6** | **≈ ₹2,250/mo/tenant all-in** |

**At ₹4,999: ~55% gross margin (~₹2,750/tenant), clears the "cost × 1.5 = ₹3,379" rule.** ✅

Caveats on this margin: (a) excludes Stripe/POBO transaction fees + dispute liability — but those are paid from *transaction* flow, not the subscription; (b) excludes support/overhead. The **subscription line is healthy**; watch the RDS line as the dominant cost. Because idle RDS is now 24/7 (can't nightly-stop a paying tenant like today's EventBridge trick), the ₹1,188/mo RDS floor is unavoidable — priced in.

---

## Part 3 — Delhivery integration (per-tenant warehouse + COD)

The good news: the store **already reconciles quoted-vs-actual Delhivery charges** — the mechanism Part 3 worries about exists. What's missing is **multi-warehouse / multi-tenant** identity.

### 3.1 Per-tenant warehouse (captured at onboarding)

Today a single warehouse lives as scalar `site_settings` values (`delhivery_origin_pincode`, `delhivery_pickup_location`, seller name/addr/phone) + hardcoded Raipur return address. For SaaS:

- Because each tenant has its **own RDS**, the existing `site_settings` warehouse keys **become per-tenant for free** — each tenant's DB holds its own warehouse config. Onboarding collects: origin pincode, Delhivery-registered pickup location name, seller name/address/phone, **return address** (fix the hardcoded Raipur/Chhattisgarh literals in `create-shipment` L124–127 and `delhivery.ts` L79–82 to read from config).
- **Unify the two code paths first:** `pickup-request/route.ts` reads `PICKUP_LOCATION` from `process.env` (L7) while `create-shipment` uses `getBusinessValues()`. Both must read the tenant's warehouse config. This is a prerequisite cleanup.
- Re-key the 30s `site-controls` cache by tenant (else warehouse config leaks across tenants).

### 3.2 Delhivery credentials per tenant

Today one `DELHIVERY_API_KEY` for the whole store. **Decision needed:** does each tenant have their own Delhivery account (own API key + registered pickup location), or do they all ride on *your* master Delhivery account with multiple registered pickup locations? This changes whether the key is per-tenant (from their Secrets Manager secret) or shared with a per-tenant `pickup_location` label. Most SaaS: **you hold one master Delhivery account, each tenant is a registered pickup location** — simpler onboarding, and it ties into the POBO money story (COD flows through *you*).

### 3.3 COD → platform money flow (bridges to Part 4)

Delhivery collects COD from the *customer's customer* and remits to **the account registered on the AWB**. If that's **your master account**, COD money lands with you (the platform), and you settle to the tenant minus fees/adjustments — this is exactly the POBO story. Existing lifecycle (`cod_pending→cod_collected→paid`, `cod_remitted_at`) becomes a **per-tenant settlement event**: when Delhivery remits COD to you, you credit the tenant's settlement ledger (Part 4), netting the subscription debit, COD surcharge, and any Delhivery charge correction.

### 3.4 The AWB-quote-vs-actual mismatch (already handled — extend it)

`sync-statuses` already computes `delhivery_extra_charge = ROUND(billed_amount − shipping_amount)` on delivery. In SaaS this per-order delta becomes a **line item against the tenant's settlement** — if actual pickup/freight cost exceeds what was quoted at checkout, the difference is deducted from the tenant's payout (or added to their next invoice). No new reconciliation math needed; we just **route the existing delta into the tenant ledger.**

---

## Part 4 — Payments & transactions (POBO via Stripe Connect)

**Decision (locked): Stripe Connect destination charges.** POBO is fully greenfield — no Stripe, no subscriptions, no split-settlement exists today. Below is the design, then the India risks you asked me to flag rather than swap.

### 4.1 Money flow (destination charges)

```
Customer's customer pays  ──►  Platform Stripe account (you are merchant of record)
                               │  ├─ application_fee_amount  ──► your platform revenue
                               │  └─ transfer to connected account (tenant) ──► tenant's Stripe balance
                               (charge + transfer are ONE atomic API call)
```

Per your correction note, and confirmed: with destination charges **your platform is liable for refunds, disputes and negative balances**, and **Stripe fees are collected from the platform** regardless of `on_behalf_of`. That operational overhead is real and belongs in the pricing.

### 4.2 New data model (greenfield — none of this exists)

- `tenant_stripe_accounts` — tenant_id, stripe_connected_account_id, onboarding_status, payouts_enabled
- `settlement_ledger` — every money movement per tenant: `+order_capture`, `−application_fee`, `−stripe_fee`, `−subscription_charge`, `+cod_remittance`, `−delhivery_charge_correction`, `−refund`, `−chargeback`. This is the single reconciliation surface across Parts 3 & 4.
- `platform_subscriptions` — Stripe Billing subscription per tenant (the plan fee). **Debit-limit** enforcement lives here.
- Extend `payments` table with: `connected_account_id`, `transfer_id`, `application_fee_amount`, `settlement_status` (the current `payments` table has none of these).

### 4.3 Subscription + debit limit + charge corrections

Your key insight in the PDF — *"since we handle the amount in between, we can apply any charges later made by Delhivery"* — is exactly right and is the reason POBO is attractive here. Because settlement flows through your platform:

- **Subscription** = Stripe Billing recurring charge on the tenant's connected account, **debited from their settlement balance** (set a debit limit = don't let the balance go negative beyond a threshold; suspend store if it does).
- **Delhivery charge corrections** (Part 3.4) and **COD reconciliation** (Part 3.3) net against the same balance before payout.
- **Payouts** to tenants **weekly** (settlement balance − pending adjustments). **Daily payout is a paid upgrade (~5% premium)** — offered as an onboarding/plan option, tracked on the subscription.

### 4.4 Gateway abstraction (Razorpay for us, Stripe for tenants — LOCKED)

`getRazorpayInstance()` has no abstraction. Introduce a `PaymentGateway` interface so **`jeffistores.in` (our own flagship store) keeps its existing Razorpay flow** (create-order → verify(HMAC) → webhook(HMAC) → the `pending_payment_intents` idempotency guard, all preserved unchanged) while **tenants run on Stripe Connect POBO**. The gateway a request uses is resolved from the tenant context: our store → Razorpay, tenants → Stripe. This is why our store stays *separate and not a tenant* — it's the one Razorpay merchant, and the abstraction cleanly isolates that from the tenant Stripe path. The **retry-safe webhook + events ledger** must be built properly for the Stripe side — the current Razorpay webhook swallows all errors and returns 200, which is fine for our single store but unacceptable for platform-scale tenant money movement.

### 4.5 🚩 India risk flags (you said keep Stripe — these are the risks, not a swap)

1. **Stripe Connect availability in India for INR domestic marketplaces is restricted.** Stripe India historically does **not** offer full Connect with `transfer`/destination charges for domestic INR seller payouts the way US/EU does. This is the **single biggest risk to Part 4** — before building, we must confirm with Stripe India whether destination charges to Indian connected accounts in INR are supported for your entity. If not, the design is sound but the *rail* would need to be **Razorpay Route** (Razorpay's native split-settlement — you already integrate Razorpay) or **Cashfree Easy Split**. The *architecture* (settlement ledger, application fee, atomic split, debit limit) is identical; only the SDK changes.
2. **RBI / cross-border:** if any settlement touches non-INR or cross-border, FEMA/RBI rules and possible PA-PG licensing apply. POBO where you're merchant-of-record for other businesses can attract **Payment Aggregator** regulatory scrutiny in India — worth a compliance check early.
3. **COD never touches Stripe** — it's collected by Delhivery and remitted to you, then ledgered manually. So Part 4's rail only covers *prepaid* orders; COD is a parallel settlement path (§3.3). The ledger unifies both.

**My recommendation:** keep the **design** as specified, but make Part 4's first build step a **1-week spike to confirm Stripe Connect India feasibility** for your exact use case. If it clears, proceed with Stripe. If not, swap the SDK to Razorpay Route — everything else in Part 4 is unchanged. I will not silently substitute; this is yours to decide once the spike returns facts.

---

## Part 5 — Custom domains + the "Ecom Store" admin section

### 5.1 Custom domains (priced add-on)

If a tenant brings their own domain (or wants a custom one), add a flat premium on top of the plan. Flow:
1. Tenant enters domain in control plane → we create a verification record (TXT/CNAME).
2. On verification, provision an **ACM cert** (or automated Let's Encrypt) and attach to CloudFront (SNI) with the tenant's origin.
3. Add domain → tenant mapping in the Tenant Registry so the host→tenant resolver recognizes it.

This is the only path needing **per-domain cert automation**; platform subdomains ride the wildcard cert.

### 5.2 New "Ecom Store" nav group in `admin.jeffistores.in`

This is low-effort because the nav is a plain array. In **`src/app/admin/layout.tsx` L38–78**, add entries with a new `group: 'Ecom Store'` (and `superAdminOnly: true` — only *you*, the platform operator, see it):

- **Customers** — tenant list, plan, status, MRR, actions (suspend/resume/terminate)
- **Instances** — per-tenant EC2/RDS/nginx/CloudFront/CA-cert status (pulled from Tenant Registry + AWS APIs)
- **Store Status** — health, uptime, provisioning state, last deploy
- **Billing** — subscriptions, settlement ledger, payouts, overdue/debit-limit breaches

Add matching icons in `AdminSidebarNav.tsx` `NAV_ICONS` (keyed by label) and new scope keys (`ecom_customers:read/write`, `ecom_instances:read`, `ecom_billing:read/write`) in `scopes.ts`. Because these are `superAdminOnly`, they never appear for tenant admins — the existing filter at `layout.tsx` L80–84 handles it. The backend for these pages **is the control plane** (§2.1).

---

## Sequenced roadmap (what to build, in order)

Each phase is shippable and de-risks the next. I'd gate Phase 0 on the two spikes.

- **Phase 0 — Spikes & decisions (before any build):**
  - Stripe Connect India feasibility spike (§4.5) — **blocks Part 4 rail choice.**
  - Confirm RDS-per-tenant cost model + Aurora Serverless v2 for Basic (§2.5) — **blocks pricing.**
  - Decide Delhivery: master account vs per-tenant (§3.2).
  - Decide custom-domain cert automation (ACM vs Let's Encrypt).

- **Phase 1 — Tenant foundation (no external tenants yet):**
  - Tenant Registry (control-plane DB + schema).
  - Request-scoped `TenantContext` (ALS) + tenant-aware `getPool()` registry + S3 prefix + Redis namespacing + per-tenant `site-controls` cache.
  - Host→tenant resolver in middleware (with reserved-word blacklist).
  - Provision a **throwaway internal test tenant** (`test.jeffistores.in`) through this machinery to prove the path end-to-end. (Our flagship `jeffistores.in` stays separate on Razorpay — it is *not* migrated into the tenant model.)
  - `scopes.ts` refactor: give piggybacking nav items their own scope keys (§1.2 gap).

- **Phase 2 — Plans & control plane MVP:**
  - `plans` / `plan_features` (scope map) + plan-filtered nav & route enforcement.
  - `ecom.jeffistores.in` onboarding UI (collect store + warehouse + branding).
  - Provisioning engine: spin RDS (Aurora SLS v2 for Basic) + S3 prefix + DNS/cert + register tenant.
  - "Ecom Store" nav group in `admin.jeffistores.in` (Customers, Instances, Store Status).

- **Phase 3 — Compute scaling:**
  - Introduce **ALB + host-based routing**; CloudFront origin → ALB.
  - Basic pooled EC2 ASG; dedicated-instance path for tier 2+.
  - Kill the daily EventBridge stop for tenant infra (must be 24/7).

- **Phase 4 — Payments & settlement (POBO):**
  - `PaymentGateway` abstraction; Stripe Connect **or** Razorpay Route per Phase-0 spike.
  - `settlement_ledger`, `platform_subscriptions`, connected-account onboarding, retry-safe webhook + events ledger.
  - Debit-limit enforcement + Billing subscription.

- **Phase 5 — Delivery & COD settlement wiring:**
  - Per-tenant warehouse (unify pickup paths, fix hardcoded return address).
  - Route existing `delhivery_extra_charge` deltas + COD remittance into the settlement ledger.

- **Phase 6 — Custom domains, monitoring, billing polish:**
  - Custom-domain onboarding + cert automation.
  - Monitoring/status dashboards; billing views; suspend/terminate lifecycle.

---

## Resolved decisions & remaining open items

**Resolved (round 1 sign-off):**
- ✅ RDS: `db.t4g.micro` provisioned per tenant. ✅ Basic price ₹4,999 (~55% margin). ✅ Principals restricted to one tenant → `tenant_id` session claim. ✅ S3 bucket-per-tenant (quota-increase prerequisite noted). ✅ Weekly payout, daily = +5% upgrade. ✅ Our store stays separate on Razorpay; tenants on Stripe via `PaymentGateway` abstraction.

**Still open (need your input before the relevant phase):**
1. **Payments rail (blocks Part 4 build):** OK to run a **1-week Stripe Connect India feasibility spike** before committing? Stripe domestic-INR seller payouts may be restricted for your entity — if the spike fails, fall back to **Razorpay Route** (same architecture, different SDK). This is *not* re-opening the Stripe decision; it's confirming the rail is legally/technically available in India before we build on it.
2. **Delhivery account model — LOCKED: master account.** You hold one master Delhivery account; each tenant is a **registered pickup location** on it. COD flows to you (the platform) → feeds the POBO settlement ledger cleanly. Per-tenant Delhivery API keys are *not* needed; the per-tenant config is the pickup-location label + warehouse address (§3.1).
3. **India PA/PG compliance:** POBO where you're merchant-of-record for other businesses can attract **Payment Aggregator** licensing scrutiny under RBI. Worth a compliance/legal check early (parallel to Phase 0) — flagging, not blocking.

**Test tenant 0:** since our store is *not* a tenant, we'll dogfood the tenant machinery with a **throwaway internal test tenant** (`test.jeffistores.in`) in Phase 1 — proves provisioning end-to-end without touching the flagship store.

---

*Grounding: this plan is derived from a full survey of `middleware.ts`, `auth-sessions.ts`, `scopes.ts`, `db.ts`, `site-controls.ts`, `delhivery.ts`, the Delhivery/shipping routes, `razorpay.ts` + payment routes, `database/*.sql` (~127 tables, zero tenant columns), the `deploy/` infra, and the `admin/` UI. Every "today" claim is code-verified.*
