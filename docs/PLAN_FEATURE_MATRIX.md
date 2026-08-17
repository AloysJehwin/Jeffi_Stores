# Per-Plan Feature & Page Matrix

Derived from the original architecture PDF (Part 1–5) + live DB scope assignments.
Last updated: 2026-08-17.

---

## CNAMEs / Subdomains

| Subdomain | Basic | Growth | Pro | Enterprise |
|-----------|:-----:|:------:|:---:|:----------:|
| `{slug}.jeffistores.in` (storefront) | ✅ | ✅ | ✅ | ✅ |
| `www.{slug}.jeffistores.in` → redirect | ✅ | ✅ | ✅ | ✅ |
| `admin-{slug}.jeffistores.in` (admin panel) | ✅ | ✅ | ✅ | ✅ |
| `invoice-{slug}.jeffistores.in` (invoice viewer) | ✅ | ✅ | ✅ | ✅ |
| `quotation-{slug}.jeffistores.in` | ❌ | ✅ | ✅ | ✅ |
| `purchaseorder-{slug}.jeffistores.in` | ❌ | ✅ | ✅ | ✅ |
| `forms-{slug}.jeffistores.in` (review forms) | ❌ | ✅ | ✅ | ✅ |
| `business.{slug}.jeffistores.in` (B2B portal) | ❌ | ❌ | ✅ | ✅ |
| Custom domain (BYO CNAME) | ❌ | ❌ | 1 | 3 |

### Notes
- All `*.jeffistores.in` subdomains are covered by the wildcard ACM cert — no per-tenant cert needed.
- Custom domains (Pro/Enterprise) require a separate ACM cert per domain issued via DNS validation.
- The middleware (`src/middleware.ts`) already routes all `{prefix}-{slug}` patterns via `slugFromHost()`.
- Subdomain access for Growth+ CNAMEs (`quotation-`, `purchaseorder-`, `forms-`) is gated by plan scope in middleware.

---

## Storefront (`{slug}.jeffistores.in`)

| Feature | Basic | Growth | Pro | Enterprise |
|---------|:-----:|:------:|:---:|:----------:|
| Full catalogue, search, cart, checkout | ✅ | ✅ | ✅ | ✅ |
| COD + online payments (Razorpay Route) | ✅ | ✅ | ✅ | ✅ |
| Wishlist & compare | ✅ | ✅ | ✅ | ✅ |
| Order tracking | ✅ | ✅ | ✅ | ✅ |
| Return / replacement request buttons | ❌ | ✅ | ✅ | ✅ |
| B2B portal login | ❌ | ❌ | ✅ | ✅ |
| Review forms | ❌ | ✅ | ✅ | ✅ |

### Enforcement
- `returnAllowed` / `replacementAllowed` on order items are forced to `false` in `src/app/api/orders/[id]/route.ts` when tenant plan lacks `returns:read`.
- B2B portal (`business.{slug}.jeffistores.in`) is middleware-gated by `business_customers:read`.

---

## Admin Panel (`admin-{slug}.jeffistores.in`)

| Page / Section | Scope | Basic | Growth | Pro | Enterprise |
|---|---|:---:|:---:|:---:|:---:|
| **Dashboard** | `dashboard:read` | ✅ | ✅ | ✅ | ✅ |
| **— Catalogue —** | | | | | |
| Products | `products:read` | ✅ | ✅ | ✅ | ✅ |
| Categories | `categories:read` | ✅ | ✅ | ✅ | ✅ |
| Brands | `brands:read` | ✅ | ✅ | ✅ | ✅ |
| AI Catalogue Enrichment | `catalog_enrichment:read` | ❌ | ❌ | ✅ | ✅ |
| Merchant Sync (Google/Amazon) | `merchant_sync:read` | ❌ | ❌ | ✅ | ✅ |
| **— Sales —** | | | | | |
| Orders (view + confirm/cancel) | `orders:read` | ✅ | ✅ | ✅ | ✅ |
| Orders → processing/shipped/delivered | `delhivery:read` | ✅ | ✅ | ✅ | ✅ |
| Orders → returned/return_received | `returns:read` | ❌ | ✅ | ✅ | ✅ |
| Invoices & Cash Sale | `invoices:read` | ❌ | ✅ | ✅ | ✅ |
| GST Compliance & Reports | `gst:read` | ❌ | ✅ | ✅ | ✅ |
| Customers | `customers:read` | ✅ | ✅ | ✅ | ✅ |
| Quotations | `quotations:read` | ❌ | ✅ | ✅ | ✅ |
| Returns | `returns:read` | ❌ | ✅ | ✅ | ✅ |
| Replacements | `replacements:read` | ❌ | ✅ | ✅ | ✅ |
| CRM | `crm:read` | ❌ | ✅ | ✅ | ✅ |
| Tasks | `tasks:read` | ❌ | ✅ | ✅ | ✅ |
| **— Fulfilment —** | | | | | |
| Packing Slips | `packing_slips:read` | ❌ | ✅ | ✅ | ✅ |
| Labels & Barcodes | `labels:read` | ❌ | ✅ | ✅ | ✅ |
| Delhivery Pickup Scheduling | `delhivery:read` | ✅ | ✅ | ✅ | ✅ |
| QuickScan (mobile) | `quick_scan:read` | ✅ | ✅ | ✅ | ✅ |
| **— Finance —** | | | | | |
| Inventory & Purchase Orders | `inventory:read` | ❌ | ✅ | ✅ | ✅ |
| Warehouse Shelving | `shelving:read` | ❌ | ✅ | ✅ | ✅ |
| Financial Reports | `financial:read` | ❌ | ❌ | ✅ | ✅ |
| Bulk Price Adjustment | `inflation:read` | ❌ | ❌ | ✅ | ✅ |
| **— Marketing —** | | | | | |
| Coupons | `coupons:read` | ❌ | ✅ | ✅ | ✅ |
| Reviews | `reviews:read` | ✅ | ✅ | ✅ | ✅ |
| Review Forms | `review_forms:read` | ❌ | ✅ | ✅ | ✅ |
| Traffic Analytics | `traffic:read` | ❌ | ✅ | ✅ | ✅ |
| Email Mailer | `mailer:read` | ❌ | ❌ | ✅ | ✅ |
| Campaigns & Automation | `campaigns:read` | ❌ | ❌ | ✅ | ✅ |
| **— AI —** | | | | | |
| AI Admin Assistant | `agent:read` | ❌ | ❌ | ✅ | ✅ |
| **— B2B —** | | | | | |
| B2B Customers & Portal | `business_customers:read` | ❌ | ❌ | ✅ | ✅ |
| B2B RFQs | `business_rfqs:read` | ❌ | ❌ | ✅ | ✅ |
| **— Settings —** | | | | | |
| Settings | `settings:read` | ✅ | ✅ | ✅ | ✅ |
| Controls & Feature Flags | `controls:read` | ✅ | ✅ | ✅ | ✅ |
| Audit Log | `audit:read` | ❌ | ❌ | ❌ | ✅ |
| Service Accounts | `service_accounts:read` | ❌ | ❌ | ❌ | ✅ |
| DB Replication | `replication:read` | ❌ | ❌ | ❌ | ✅ |

### Order Status State Machine per Plan

| Status transition | Basic | Growth | Pro | Enterprise | Enforcement |
|---|:---:|:---:|:---:|:---:|---|
| pending → confirmed | ✅ | ✅ | ✅ | ✅ | Always allowed |
| confirmed → cancelled | ✅ | ✅ | ✅ | ✅ | Always allowed |
| confirmed → processing | ✅ | ✅ | ✅ | ✅ | Requires `delhivery:read` (Basic has it) |
| processing → shipped | ✅ | ✅ | ✅ | ✅ | Requires `delhivery:read` |
| shipped → delivered | ✅ | ✅ | ✅ | ✅ | Requires `delhivery:read` |
| delivered → returned | ❌ | ✅ | ✅ | ✅ | Requires `returns:read` — gated in `orders/[id]/route.ts` |
| delivered → return_received | ❌ | ✅ | ✅ | ✅ | Requires `returns:read` |
| Inventory restore on return | ❌ | ✅ | ✅ | ✅ | `restoreOrderStock()` skipped if no `inventory:read` |

---

## Infrastructure per Plan

| Resource | Basic | Growth | Pro | Enterprise |
|---------|-------|--------|-----|-----------|
| RDS instance | Dedicated | Dedicated | Dedicated | Dedicated |
| EC2 / app server | Pooled shared fleet | Dedicated | Dedicated + larger | Dedicated + ALB + ASG |
| S3 bucket | Per-tenant | Per-tenant | Per-tenant | Per-tenant |
| Nginx / CNAME | Auto-provisioned | Auto-provisioned | Auto-provisioned | Auto-provisioned |
| ACM cert | Wildcard `*.jeffistores.in` | Wildcard | Wildcard | Wildcard + custom domain cert |

---

## Pricing Model

Plans are priced at 50% profit margin over AWS infrastructure cost.

| Plan | Monthly (INR) | Yearly (INR) | Yearly discount |
|------|:-------------:|:------------:|:---------------:|
| Basic | ₹4,999 | ₹47,990 | 20% off |
| Growth | ₹9,999 | ₹95,990 | 20% off |
| Pro | ₹19,999 | ₹1,91,990 | 20% off |
| Enterprise | ₹49,999 | ₹4,79,990 | 20% off |

Custom domain add-on: charged on top of subscription (amount TBD).

---

## Enforcement Architecture

### Current implementation
- **Middleware** (`src/middleware.ts`): `getScopeForPath()` → `hasScope()` gates all `/api/admin/*` and `/admin/*` routes.
- **Route handlers**: redundant `hasScope(admin.role, admin.scopes, 'scope:verb')` check inside each handler.
- **Storefront API** (`src/app/api/orders/[id]/route.ts`): `getCurrentTenant()` plan check forces `returnAllowed=false` for Basic.
- **Delhivery route** (`src/app/api/admin/delhivery/pickup-request/route.ts`): now correctly checks `delhivery:read/write` (was wrongly checking `orders:read/write`).

### Planned: PlanGateService
A common server-side utility to replace scattered checks:
```ts
planGate(tenantId, 'returns:read')
// → { allowed: boolean, plan: string, upgradeRequired: string | null }
```
Caches plan scope set ~60s from control-plane DB. To be applied at:
- All API route handlers (replaces inline `hasScope`)
- Storefront feature flags (`returnAllowed`, `replacementAllowed`, review forms)
- Subdomain middleware gate
- Admin nav link visibility

---

## Recent Changes (2026-08-17)

### DB Scope Changes Applied
- Removed from Basic: `invoices:read/write`, `gst:read/write`, `packing_slips:read/write`, `labels:read/write`
- Added to Basic: `reviews:read/write`, `delhivery:read/write`, `quick_scan:read/write`
- Basic plan now has 21 scopes — focused on core storefront + orders + delivery

### Service-Level Changes Applied
- **Delhivery route** (`src/app/api/admin/delhivery/pickup-request/route.ts`): fixed scope check from `orders:read/write` → `delhivery:read/write`
- **Order status gate** (`src/app/api/admin/orders/[id]/route.ts`): blocks `returned`/`return_received` for tenants without `returns:read`; inventory restore (`restoreOrderStock`) skipped if no `inventory:read`
- **Storefront order API** (`src/app/api/orders/[id]/route.ts`): `returnAllowed`/`replacementAllowed` forced to `false` for Basic plan via `currentTenantPlanGate('returns:read')`
- **Product form** (`src/components/admin/ProductForm.tsx`): `hasInventory` prop hides `inventory_sync`, `perishable`, `serialized` flags for Basic plan
- **Brand form** (`src/components/admin/BrandForm.tsx`): `hasReturns` prop hides Return & Replacement Policy section for Basic plan
- **Product/brand edit pages**: pass `hasInventory`/`hasReturns` from admin session scopes
- **Customer detail page** (`src/app/admin/customers/[id]/page.tsx`): WhatsApp/CRM engagement chips hidden for Basic (requires `crm:read` — Growth+)
- **WhatsApp API** (`src/app/api/admin/customers/[id]/whatsapp/route.ts`): scope changed from `customers:read/write` → `crm:read/write` (Growth+)
- **Middleware** (`src/middleware.ts`): `/admin/ecom/*` and `/api/admin/ecom/*` blocked on tenant admin subdomains (`admin-{slug}.`); only accessible on `admin.jeffistores.in`
- **site-controls** (`src/lib/site-controls.ts`): added `inventoryValidationEnabled` feature flag (key: `feature_inventory_validation_enabled`, default: `true`)

### PlanGateService Built
- `src/lib/plan-gate.ts` — central plan feature gate
- `planGate(tenantId, scopeKey)` → `{ allowed, plan, upgradeRequired }`
- `currentTenantPlanGate(scopeKey)` — for storefront API routes using TenantContext
- 60s in-process cache, invalidated on plan change
- `controlPlanePool` exported from `tenant-registry.ts`

### Group B — ALL COMPLETED ✅
- B1: `inventoryValidationEnabled` feature flag added to site-controls
- B2: `inventory_sync`, `perishable`, `serialized` hidden in product form for Basic
- B3: Return/replacement policy hidden in brand form + storefront order API for Basic
- B4: WhatsApp/SMS gated to `crm:read` (Growth+) in customer detail + API
- B5: `/admin/ecom/*` blocked on tenant admin subdomains in middleware

### Group C/D — ALL COMPLETED ✅

#### Razorpay Route (POBO) — LIVE
- `src/lib/razorpay-route.ts` — linked account creation, payment transfer, reverse
- KYC approval creates Route linked account (`acc_xxxx`) on tenant
- Payment capture fires transfer to linked account (3% platform commission)
- Bank verification uses Razorpay FAV (Fund Account Validation) — instant, no UTR needed
- **Test mode**: Route linked account creation requires live keys — `createLinkedAccount()` fails silently in test, logs warning, provisioning continues

#### Store Owner Admin Access
- On `subscription.charged` webhook: `provisionTenantOwnerAdmin()` creates super_admin user + all scopes in tenant DB
- Generates mTLS client certificate (p12) and emails it to owner
- Owner can access `admin-{slug}.jeffistores.in` using the cert + OTP/Google login

#### Ecom Onboarding Emails (`src/lib/ecom-emails.ts`)
| Event | Trigger | Recipient |
|-------|---------|-----------|
| KYC submitted | `POST /api/ecom/onboard/submit` | Owner + platform admin |
| KYC approved | Admin approves | Owner (includes checkout URL) |
| KYC rejected | Admin rejects | Owner (includes reason) |
| Payment confirmed | `/onboard/success` page | Owner |
| Store live + cert | `subscription.charged` webhook | Owner (includes admin cert attachment) |

#### Per-Tenant Email Addresses
Generated columns on `tenants` table — no per-tenant SES identity needed (domain identity for `jeffistores.in` covers all):
- `noreply-{slug}@jeffistores.in` — all plans, transactional
- `campaigns-{slug}@jeffistores.in` — Pro+ only, marketing
- Use `tenantNoReplyEmail(slug)` / `tenantCampaignEmail(slug)` from `src/lib/ecom-emails.ts`

### Still Pending
- C: DB replication → tenant S3 bucket (replaces Razer system) — deferred
- D: Service accounts tenant-scope refactor — deferred
- Google Sign-in for tenant storefronts — already works via `openGoogleOAuthPopup` subdomain stripping

### Group E — Remaining SaaS work (2026-08-17) — CODE COMPLETE ✅

#### Storefront Google Auth (tenant subdomains) — FIXED
- `src/lib/google-oauth-popup.ts` — `stripAppSubdomain` now collapses ANY `*.jeffistores.in` subdomain (including tenant `{slug}.`) to root, so OAuth callback always reaches the registered `jeffistores.in/auth/google/callback` redirect URI. Popup postMessages token cross-subdomain via `'*'` target.

#### Migration Fan-out — BUILT
- `src/lib/tenant-migrations.ts` — `runMigrationFanout(gitSha)` enumerates active tenants, connects per-tenant via IAM pool, applies desired-state schema (idempotent), records one `tenant_migration_runs` row per (tenant, gitSha). Skips already-applied. `getMigrationRuns()` for admin visibility.
- `src/lib/tenant-migrations-schema.ts` — shared `buildTenantSchemaSql()` (apply order: extensions→tables→constraints→indexes→functions→triggers)
- `POST /api/admin/ecom/migrations/run` — super-admin trigger; `GET` for run history

#### Custom Domains (BYO CNAME) — BUILT
- `tenant_custom_domains` table (multi-domain, Enterprise=3) — supersedes single `tenants.custom_domain`
- `lookupTenant('custom_domain')` now resolves via verified `tenant_custom_domains` (+ legacy fallback)
- Registry: `addCustomDomain` (plan-quota enforced), `listCustomDomains`, `setCustomDomainStatus`, `deleteCustomDomain`
- `POST/GET /api/ecom/domains` + `POST /api/ecom/domains/[id]/verify` (real DNS CNAME check)
- `src/app/ecom/dashboard/store/CustomDomains.tsx` — owner UI (add domain, show CNAME target, verify button)
- ⚠️ ACM cert issuance + CloudFront attach = separate infra step (verification marks 'verified'; TLS follows)

#### COD Settlement — BUILT
- `recordCodSettlement()` in `src/lib/razorpay-route.ts` — ledger-based (COD has no Razorpay payment_id)
- Wired into `POST /api/admin/financial/cod-remittance` — on remittance, records `tenant_transactions` + `settlement_ledger` with gross − commission − ACTUAL Delhivery charge (`delhivery_billed_amount`)
- Fixes the flat ₹20 buffer → uses reconciled `delhivery_billed_amount` (falls back to estimate)

#### AWS Provisioning Provider — SKELETON (needs live AWS)
- `src/lib/provisioning/aws-provider.ts` — real @aws-sdk RDS + S3 calls (param group, create instance, poll endpoint, loadSchema via IAM, lock-down bucket, stop/start/delete)
- Enabled via `PROVISIONING_PROVIDER=aws` in `index.ts` (lazy-loaded)
- Installed `@aws-sdk/client-rds`
- ⚠️ Cannot verify locally — needs live AWS + RDS_MASTER_PASSWORD + certs/global-bundle.pem

### Infra-Only (not code — needs AWS/ops)
- ALB + ASG for pooled Basic fleet
- SSM Run Command deploy fan-out (replace single-IP SSH)
- Golden AMI + Launch Template
- Dedicated-tenant EC2 launch (Growth+) with TENANT_PIN
- RDS Proxy
- ACM cert issuance for custom domains + CloudFront alternate-domain attach



- Plan scope assignments: `jeffi_control_plane.plan_features` table (local port 5432)
- Scope definitions: `src/lib/scopes.ts`
- Subdomain routing: `src/middleware.ts` + `src/lib/tenant-registry.ts` (`slugFromHost`, `RESERVED_LABELS`)
- Plan pricing: `jeffi_control_plane.plans` table
