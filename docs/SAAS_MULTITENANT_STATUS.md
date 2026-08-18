# SaaS Multi-Tenant Foundation — Status Summary
_Last updated: 2026-08-18_

Branch: `feat/multitenant-foundation` → **PR #425** (open, do NOT merge until instructed)

---

## What Has Been Done

### 1. Tenant Foundation (earlier sessions)
- **Control-plane schema** — `jeffi_control_plane` DB: `tenants`, `owners`, `owner_tenants`, `plans`, `plan_features`, `tenant_infra`, `provisioning_jobs`, `tenant_transactions`, `settlement_ledger`, `tenant_metrics_daily`, `tenant_migration_runs`
- **Host→tenant resolver** — middleware resolves the request `Host` header to a `TenantContext`, caches ~60s, rejects cross-tenant session replays
- **Tenant-aware DB pool** — `db.ts` routes each request to the tenant's own RDS (or the platform default when no tenant is in context). The `tenant_id` claim is snapshotted into sessions
- **Ecom control plane** — admin `Ecom Store` section (Customers / Instances / Store Status / Billing); superAdminOnly, reads the tenant registry
- **Owner auth** — passwordless (OTP + Google) owners; `owners` + `owner_tenants` tables; owner sessions separate from admin/customer
- **Onboarding wizard** — multi-step (plan → store → warehouse → bank → review); `slug` validation, reserved-word blocking, bank verification (penny-drop), onboarding gated on verified bank
- **Per-plan feature gating** — `plan-gate.ts`; scoped to Basic / Growth / Pro / Enterprise
- **Razorpay Route (POBO)** — linked accounts, 3% commission split, COD settlement ledger
- **Store-owner provisioning** — on `subscription.charged`, creates `super_admin` + mTLS cert in tenant DB, emails cert
- **Onboarding emails** — KYC submitted/approved/rejected, payment confirmed, store live
- **Migration fan-out** — `tenant-migrations.ts` + `POST /api/admin/ecom/migrations/run`
- **Custom domains** — `tenant_custom_domains` table, DNS CNAME verify, `CustomDomains.tsx`
- **Deprovision + backup** — `deprovisionTenant()`: status→terminated → backup DB to S3 → delete RDS + bucket → clear infra. Auto-fires on `subscription.cancelled/completed`
- **Restore on re-onboard** — detects a prior backup; OnboardWizard shows opt-in banner; `restore_data` step in the state machine
- **AWS provisioning provider** — real `@aws-sdk` RDS/S3 (`AwsProvisioningProvider`); enabled via `PROVISIONING_PROVIDER=aws`
- **ecom.jeffistores.in landing** — Bento grid, pricing page, split-screen signin/signup, screenshot showcases
- **SaaS landing SEO + mobile** — conditional nav, responsive layout, Google OAuth for tenant storefronts

### 2. Live-Test Fixes (2026-08-18 session)
All of these were **found by actually running the engine end-to-end** and are now committed.

| Fix | Commit | File(s) |
|-----|--------|---------|
| Middleware dropped `x-tenant-slug` on storefront/doc/tenant-admin rewrites → silently fell back to platform DB | `7af2bd1e` | `src/middleware.ts` |
| `getPool()` ignored resolved tenant ctx (`enterWith` didn't survive the `await` back to caller) | `28c3729d` | `src/lib/db.ts` |
| `aws-provider.tenantPool()` used IAM token for master user — wrong; master user is password-auth | `28c3729d` | `src/lib/provisioning/aws-provider.ts` |

### 3. Provisioning Engine Hardening (2026-08-18 session)

#### P0 — blocked real customers without these (`220378e6`)
| Item | What |
|------|------|
| `preflight` step | Fails fast before any billable infra if `RDS_MASTER_PASSWORD` or `TENANT_APP_TARGET_IP` is unset |
| `verify_serving` step | HTTPS-probes `https://{slug}.jeffistores.in` before `activate` — won't mark active until the host actually serves |
| Stable DNS target | Removed hardcoded dead-IP default (`32.196.38.130`) from `tenant-dns.ts`; throws if `TENANT_APP_TARGET_IP` unset |
| Value-agnostic DNS teardown | `deleteTenantDns` now list-then-deletes with real record values; survives IP changes; stale records no longer left behind |
| Auto-rollback | Wired orphaned `rollbackProvisioning()` into the failure path; removes DNS + infra + sets `suspended` status — no leaked billing |
| Guarded `activate` | Refuses to set `active` if `rds_endpoint` not persisted (prevents main-DB fallback on a reorder) |
| Tenant nginx blocks committed | Added `~^(?<thost>...)\.jeffistores\.in$` regex `server_name` blocks to `deploy/nginx-servers.conf` — were only hand-applied on the box; a repo rebuild EC2 would have 404'd every tenant |

#### P1 — robustness (`8db20174`)
| Item | What |
|------|------|
| Retry + backoff | Classifies transient vs terminal errors; retryable stays `pending` with exponential backoff (15s base → 10min cap); capped at 8 attempts; `attempts` column is now load-bearing |
| `next_attempt_at` column | Added to `provisioning_jobs`; `activeProvisioningJobs` skips jobs not yet due |
| Param-group teardown | Added `deleteParamGroup` + `isDbInstanceGone` to provider interface + AWS/stub impls; `deleteParamGroupWhenDbGone` helper wired into both `deprovisionTenant` and `rollbackProvisioning` — no orphaned `jeffi-tenant-{slug}-pg16` groups |

#### P2 — defense-in-depth (`163b6800`)
| Item | What |
|------|------|
| `wait_db_available` deadline | Fails after 25 min instead of polling forever (catches stuck/incompatible-parameters RDS) |
| Reconciliation sweep | `reconcileOrphanedTenants()` in tenant-registry; finds `status=active` + null `rds_endpoint` → flips to `suspended`; runs every cron tick |
| `seed_data` step | Optional no-op step after `restore_data`; only seeds if job carries `seedProfile`; empty-by-default is the explicit documented choice |

### 4. Infra Prerequisites (applied to prod, 2026-08-18)
All applied directly to the live environment.

| Item | Status |
|------|--------|
| `RDS_MASTER_PASSWORD` added to `jeffi/production` secret | ✅ done |
| Stable EIP `52.20.193.62` attached to prod EC2 | ✅ done |
| `TENANT_APP_TARGET_IP=52.20.193.62` in `jeffi/production` | ✅ done |
| CloudFront `E1M6ZFCWXAMF26` origin repointed to EIP DNS name | ✅ done |
| `admin.`/`business.` DNS A-records fixed to new EIP | ✅ done |
| Wildcard `*.jeffistores.in` TLS cert (certbot dns-route53) | ✅ already existed |
| IAM `jeffi-tenant-provisioning` policy on `jeffi-stores-ec2-role` | ✅ done |
| Tenant nginx regex blocks in `deploy/nginx-servers.conf` | ✅ committed |
| SG intra-port-3000 rule removed (no longer needed) | ✅ done |

### 5. Key Files
```
src/lib/provisioning/
  steps.ts          — 12-step state machine (preflight→activate)
  aws-provider.ts   — real @aws-sdk RDS/S3/Route53 impl
  stub-provider.ts  — in-memory test stub
  provider.ts       — provider interface
  seed.ts           — optional seed_data seam (no-op; extend per profile)
  index.ts          — provider factory (PROVISIONING_PROVIDER=aws|stub)

src/lib/tenant-dns.ts            — Route53 UPSERT/DELETE (value-agnostic teardown)
src/lib/tenant-registry.ts       — control-plane pool, lookupTenant, reconcileOrphanedTenants
src/lib/db.ts                    — tenant-aware DB pool, ensureTenantContext
src/middleware.ts                 — host→tenant resolver, x-tenant-slug forwarding
src/app/api/cron/provisioning-worker/route.ts — in-VPC cron driver
deploy/nginx-servers.conf        — nginx including tenant wildcard server_name blocks
database/control-plane/schema.sql
```

---

## What Is Pending

### Must-do before real customers (your action)

| # | Item | Notes |
|---|------|-------|
| 🔴 **1** | **Merge PR #425 → main** | Deploys all code fixes + makes prod pick up `RDS_MASTER_PASSWORD`. This is the real gate. Do NOT merge until you've reviewed. |
| 🔴 **2** | **Schedule the cron worker** | `GET /api/cron/provisioning-worker`, Bearer `$CRON_SECRET`, every ~1 min. Without this, enqueued provisioning jobs never advance and the reconciliation sweep never runs. |
| 🔴 **3** | **Rotate the leaked `Authorization` token** | `.mcp.json` was accidentally pushed in commit `9e11c9f4` (since gitignored + untracked). The `Authorization` header value in that commit is still in git history. Rotate the token for whatever service it belongs to. |

### Important but not blocking

| # | Item | Notes |
|---|------|-------|
| 🟡 **4** | **Add alerting on failed/stuck provisioning jobs** | Query `provisioning_jobs WHERE status='failed'` or `updated_at < now()-interval '30min' AND status IN ('pending','running')` |
| 🟡 **5** | **Document the deprovision multi-minute reality** | RDS delete takes several minutes; deprovision returns before the DB is actually gone. Operators should know to wait before re-provisioning the same slug. |

### Razorpay (separate gate)
| Item | Notes |
|------|-------|
| Switch to LIVE Razorpay keys | Route linked accounts fail silently in test mode. `approve-kyc` route creates the linked account — works only with live keys. |

### Code quality (P1 items left in the analysis — not started)
These are nice-to-have improvements beyond what was built:
- `wait_db_available` stuck-job alert (the 25-min deadline terminates the job, but no notification is sent)
- Seed catalog profiles in `seed.ts` (currently the seam exists but no profiles are implemented)

---

## Architecture in One Paragraph

Each signed-up tenant gets a dedicated `db.t4g.micro` RDS Postgres instance + an S3 bucket, provisioned by a 12-step state machine (`steps.ts`) driven by an in-VPC cron worker. DNS (`{slug}.jeffistores.in` etc.) points at the shared prod EC2 via Route53 A-records. The app's middleware resolves the request `Host` header to a `TenantContext` and forwards `x-tenant-slug` to the route handler; `db.ts` uses that to route queries to the tenant's own RDS instead of the platform DB. Deprovision backs up the DB to S3, deletes RDS + bucket, and clears DNS — a returning owner can restore from the backup on re-onboard.
