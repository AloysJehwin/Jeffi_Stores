# SaaS Multi-Tenant Foundation — Status Summary
_Last updated: 2026-08-26_

Branch: `feat/multitenant-foundation` → **PR #425** (open, do NOT merge until instructed)

> **This is the authoritative status doc for the multi-tenant effort.** It SUPERSEDES the
> earlier design docs, which were written before any code existed and still describe the work
> as unstarted:
> `archive/SAAS_MULTITENANT_PLAN.md` ("No code written yet"), `MULTI_TENANT_PHASES.md` (local
> only, not checked in; Phases 0–5 "not started"), `archive/PROVISIONING_ENGINE_PLAN.md` ("Design
> for review, no code"), `archive/PROXY_ASG_PLAN.md` (flags `/api/health` debt that is already fixed — readiness now lives at
> `/api/ready`). Read those for *design rationale only*; trust this file for current state.

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

### 5. The Provisioning Steps (current, verified against `steps.ts`)

The state machine is **15 steps**, in this order. One step per worker tick; each is idempotent so a
crash/retry re-runs it safely. On success a step returns the next step name; on throw the job is
classified retryable (backoff, stays `pending`) or terminal (fail + auto-rollback).

| # | Step | What it does |
|---|------|--------------|
| 1 | `preflight` | Fails fast if `RDS_MASTER_PASSWORD` / `TENANT_APP_TARGET_IP` are unset — **before** any billable infra exists |
| 2 | `create_param_group` | PG16 param group with `max_connections=50` (100 OOM'd a t4g.micro previously) |
| 3 | `create_db_instance` | Creates the tenant's `db.t4g.micro`. Returns immediately; not yet available |
| 4 | `wait_db_available` | Polls for the endpoint. **25-min deadline**, then fails → rollback (catches stuck / incompatible-parameters) |
| 5 | `load_schema` | Applies desired-state schema **only — 0 rows**. A fresh tenant store is intentionally empty |
| 6 | `restore_data` | No-op unless the job carries `restoreFromKey` (churned owner re-onboarding from an S3 backup) |
| 7 | `seed_data` | No-op unless the job carries `seedProfile`; skipped entirely if the store was restored. Seam exists, **no profiles implemented** |
| 8 | `create_bucket` | Creates + locks down `jeffi-tenant-{slug}` (public-access-block on) |
| 9 | `write_infra` | Persists `rds_endpoint` + `s3_bucket` into `tenant_infra` |
| 10 | `generate_legals` | Templated terms/privacy/refund pages from business details + logo into the bucket. **Non-fatal** — a failure records `legalsError` and continues |
| 11 | `ensure_compute` | Basic → shared pool EC2; growth/pro/enterprise → **dedicated EC2**. If no `TENANT_APP_AMI_ID`/`POOL_INSTANCE_ID`, falls back to the shared `TENANT_APP_TARGET_IP`. Serving IP persisted to `tenant_infra.ec2_target` |
| 12 | `setup_delhivery` | Registers the pickup/client warehouse from onboarding config. **Non-fatal** — shipments just can't be created until fixed |
| 13 | `configure_dns` | Route53 A-records for the plan's hostnames, pointed at the resolved serving IP |
| 14 | `verify_serving` | HTTPS-probes `https://{slug}.jeffistores.in`; any HTTP response proves the app tier answers. 6 attempts, then fail. **Skipped under the stub provider** (no real infra to serve) |
| 15 | `activate` | Guarded: refuses if `rds_endpoint` isn't persisted (else `getPool` would silently fall back to the platform DB). Sets tenant `active`, job `done` |

**Hostnames by plan tier** (`tenantHostnames`) — Basic: `{slug}`, `admin-{slug}`, `invoice-{slug}`;
growth+ adds `quotation-{slug}`, `purchaseorder-{slug}`; pro+ adds `forms-{slug}`, `{slug}.business`.

**Failure handling** — transient errors retry with exponential backoff (15s base, 10-min cap, max 8
attempts, deterministic jitter — no `Math.random`). Terminal errors (`AccessDenied`, `preflight:`,
`activate blocked`, `InvalidParameterValue`, …) fail immediately and fire `rollbackProvisioning()`:
DNS → dedicated EC2 → bucket → RDS → param group (only once the DB is confirmed gone) → clear infra
→ status `suspended` (distinguishable from a clean `terminated` deprovision).

### 6. Local Provisioning Testing (added 2026-08-26)

Running the engine from a laptop hits one problem the in-VPC app doesn't: the tenant RDS is created
`PubliclyAccessible: false` and its security group only admits in-VPC traffic, so the data-plane
steps (`load_schema`, `restore_data`, `backup`) hang until the 20s connect timeout.

**`TENANT_RDS_PUBLIC_TEST=true`** covers this. It is **LOCAL-TEST ONLY — never set it in production.**
When set, `createDbInstance`:

1. Creates the tenant RDS with `PubliclyAccessible: true` (pre-existing behavior), **and**
2. Detects this machine's public IP (`https://checkip.amazonaws.com`) and authorizes it on **5432**
   in the tenant RDS security group, described `jeffi-local-test <date> (safe to revoke)`.

Step 2 is new — it was previously a manual "pair with a one-time SG rule" step, which silently broke
every time your IP changed. It is **best-effort and never fatal**: if IP detection or the authorize
call fails it logs to stderr and provisioning continues (you may already have access, or be in-VPC).
It is idempotent (`InvalidPermission.Duplicate` = success) and re-runs on retry, so a mid-session IP
change self-heals. With the flag absent, `PubliclyAccessible` is `false` and **no SG call is made at
all** — prod behavior is unchanged.

Implemented via `authorizeSgIngress` / `revokeSgIngress` / `currentPublicIp` in `src/lib/ec2-client.ts`
(the existing minimal SigV4 EC2 Query-API client — deliberately avoids adding `@aws-sdk/client-ec2`,
which would version-skew against the installed 3.477 SDK).

> **Housekeeping:** the tenant RDS SG (`sg-0e361f0f1b093bd83`) currently carries **5 stale CIDR rules**
> on 5432, one self-described `"TEMP local provisioning test - REMOVE after"` (`103.109.144.13/32`).
> They were left in place deliberately — some may be teammate/office IPs and are not safely
> distinguishable from abandoned test rules. Worth an audit; use `revokeSgIngress` to drop them.

### 7. Key Files
```
src/lib/provisioning/
  steps.ts          — 15-step state machine (preflight→activate) + reprovisionDns (DNS-only plan change)
  trigger.ts        — single entry point for all 4 flows (triggerProvisioning + kickAdvance)
  aws-provider.ts   — real @aws-sdk RDS/S3/Route53 impl
  stub-provider.ts  — in-memory test stub
  provider.ts       — provider interface
  seed.ts           — optional seed_data seam (no-op; extend per profile)
  index.ts          — provider factory (PROVISIONING_PROVIDER=aws|stub)

src/lib/tenant-dns.ts            — Route53 UPSERT/DELETE (value-agnostic teardown)
src/lib/tenant-registry.ts       — control-plane pool, lookupTenant, reconcileOrphanedTenants
src/lib/db.ts                    — tenant-aware DB pool, ensureTenantContext
src/middleware.ts                 — host→tenant resolver, x-tenant-slug forwarding
src/app/api/ecom/provisioning/route.ts        — canonical owner-portal trigger (owner-session gated)
src/app/api/internal/provisioning/worker/route.ts    — ACTIVE driver; advances every in-flight job one step per 45s tick
src/app/api/internal/provisioning/advance/route.ts   — legacy single-tenant self-advance loop (superseded; see below)
src/app/api/internal/provisioning/reconcile/route.ts — hourly drift sweep (from instrumentation.ts)
src/instrumentation.ts            — in-app scheduler; 45s provisioning worker + hourly reconcile
src/lib/ec2-client.ts             — minimal SigV4 EC2 Query-API client (no @aws-sdk/client-ec2 dep)
deploy/nginx-servers.conf        — nginx including tenant wildcard server_name blocks
database/control-plane/schema.sql
```

---

## What Is Pending

### Must-do before real customers (your action)

| # | Item | Notes |
|---|------|-------|
| 🔴 **1** | **Merge PR #425 → main** | Deploys all code fixes + makes prod pick up `RDS_MASTER_PASSWORD`. This is the real gate. Do NOT merge until you've reviewed. |
| 🔴 **2** | **Provisioning is now EVENT-DRIVEN (no cron)** | **Reworked 2026-08-22.** Provisioning is triggered by exactly four flows, all from the ecom owner portal, each handing a full self-contained payload to `triggerProvisioning()` (`src/lib/provisioning/trigger.ts`): (1) first provision — `subscription.charged` webhook + onboard success page; (2) plan upgrade/downgrade — `change-plan` route → `reprovisionDns` (DNS-only, never recreates infra); (3) deprovision on missed payment — `subscription.cancelled`/`completed` webhook; (4) owner cancel — `POST /api/ecom/provisioning {action:'deprovision'}` cancels the Razorpay sub, and the webhook then deprovisions. The **GitHub Actions driver + `/api/cron/provisioning-worker` are deleted** (the GH workflow was also disabled in the Actions tab).<br><br>**⚠️ Corrected 2026-08-26 — how jobs advance.** This row previously claimed there was "no more cron worker" and that the engine self-advanced via a `setTimeout` re-invoke loop against `/api/internal/provisioning/advance`. **That approach was tried and abandoned** — in the Next server model the request scope is torn down after the response, so the post-response timer may never fire (observed in practice: the loop never started; see the comment in `trigger.ts`). What actually runs today:<br>• `triggerProvisioning()` drives the cheap control-plane steps **inline**, bounded to `MAX_INLINE_STEPS = 6`, then stops as soon as the job parks on a polling step (`wait_db_available` / `verify_serving`) or hits a terminal state.<br>• A **recurring in-app worker** takes it from there: `GET /api/internal/provisioning/worker` (Bearer `CRON_SECRET`), fired every **45s** by `setInterval` in `src/instrumentation.ts`. It advances *every* active job one step per tick — this is what carries a job across the ~10-min RDS create.<br>• `/api/internal/provisioning/advance` still exists but is **not wired to the scheduler**; it is legacy. Both routes fire `provisionTenantOwnerAdmin` on transition to `done`. The `provisionTenantOwnerAdmin` super_admin/cert now fires when the job reaches `done` (after the tenant RDS exists), not at payment time. Admin operator routes (`/api/admin/ecom/customers/[id]/provision`+`/deprovision`) are kept as a manual override and now route through the same shared trigger. |
| | *Schedules in `instrumentation.ts`* | Two: the **45s provisioning worker** (above) and `reconcileOrphanedTenants()` (drift sweep) **hourly** against `/api/internal/provisioning/reconcile`. The sweep does not need 60-second resolution. |
| | *Clarification on "in-VPC"* | The worker/reconcile routes run **on the app**, which is already in-VPC, so their data-plane steps (`load_schema`, `restore_data`, backup) reach the `PubliclyAccessible: false` tenant RDS fine. Self-calls target `APP_URL` (`https://jeffistores.in`) with `Authorization: Bearer $CRON_SECRET`; CloudFront `/api/*` forwards `Authorization` (Managed-AllViewer) + disables caching, so it is a safe self-call host. **Running the engine from a laptop is the exception** — see *Local provisioning testing* below. |

### Important but not blocking

| # | Item | Notes |
|---|------|-------|
| 🟡 **3** | **Add alerting on failed/stuck provisioning jobs** | Query `provisioning_jobs WHERE status='failed'` or `updated_at < now()-interval '30min' AND status IN ('pending','running')` |
| 🟡 **4** | **Document the deprovision multi-minute reality** | RDS delete takes several minutes; deprovision returns before the DB is actually gone. Operators should know to wait before re-provisioning the same slug. |
| 🟡 **5** | **Wildcard cert renewal is now a fleet-wide SPOF** | Cert expires **2026-11-15**. Every tenant's HTTPS depends on it. Wildcards need DNS-01, so certbot auto-renew must retain working `dns-route53` creds on the box — a silent renewal failure takes down *all* tenants at once. Verify `certbot renew --dry-run` + add an expiry alert. |
| 🟡 **6** | **Release the idle EIP `32.196.38.130`** | The old (pre-EIP-swap) address is still allocated and **unassociated** — AWS bills idle EIPs (~$3.60/mo). Three other EIPs are attached to non-instance ENIs and are worth an audit at the same time. |
| 🟡 **7** | **`deploy/aws/aws-infrastructure.yaml` still documents the dead IP** | `32.196.38.130` appears in 4 places incl. `EC2_HOST`. Verified **not consumed by any tooling** (doc-only, so nothing breaks) — but it's the file an operator would trust mid-incident. Update to `52.20.193.62`. |
| 🟡 **8** | **Never re-enable the EC2/RDS start-stop schedules** | `jeffi-start/stop-ec2` + `jeffi-start/stop-rds` in EventBridge group `jeffi-stores` are currently **DISABLED** (app runs 24/7 — correct for SaaS). Re-enabling them would take **every tenant storefront offline overnight**, and would stall the provisioning worker during the down window. The stale comment in `deploy/sync-cron-setup.sh` ("app is only up 09:00–00:00 IST") predates this and should be corrected. |
| 🟡 **9** | **Local AWS CLI is authenticated as account ROOT** | The `default` profile holds **root access keys** (`arn:aws:iam::708835965056:root`, `AccountAccessKeysPresent: 1`). Root keys bypass all IAM policy/boundaries/SCPs; root MFA (enabled) does **not** protect them. 5 IAM users already exist. Point `default` at a scoped IAM admin (or Identity Center) and delete the root access keys. Does not affect the app, which correctly uses the `jeffi-tenant-provisioning` role on the EC2 instance profile. |

### Resolved / no action

| Item | Outcome |
|------|---------|
| `.mcp.json` `Authorization` header pushed in `9e11c9f4` | **Accepted — no rotation needed.** The credential is the **Razorpay MCP** token (`mcp.razorpay.com`) and is a **test-mode** cred (account is on `rzp_test_*` keys), so it cannot move real money. File is now untracked + gitignored (`edcae0c2`). The value remains readable in git history — if the account is ever switched to LIVE keys, re-check that this token was not promoted alongside them. |

### Razorpay (separate gate)
| Item | Notes |
|------|-------|
| Switch to LIVE Razorpay keys | Route linked accounts fail silently in test mode. `approve-kyc` route creates the linked account — works only with live keys. |

### Code quality (P1 items left in the analysis — not started)
These are nice-to-have improvements beyond what was built:
- `wait_db_available` stuck-job alert (the 25-min deadline terminates the job, but no notification is sent)
- Seed catalog profiles in `seed.ts` (currently the seam exists but no profiles are implemented)
- `aws-provider.ts` uses 5 **extensionless dynamic imports** (`await import('../tenant-migrations-schema')`,
  `'../tenant-db-backup')`, `'../tenant-dns')`). Fine under Next's bundler (how the app runs), but they
  fail under raw Node ESM — so the engine can't be driven by a plain `node` script without adding
  `.js` extensions. Matters if the cron worker is ever moved to a standalone Lambda.

---

## Architecture in One Paragraph

Each signed-up tenant gets a dedicated `db.t4g.micro` RDS Postgres instance + an S3 bucket, provisioned by a 15-step state machine (`steps.ts`) driven by an in-app recurring worker (45s tick) running in-VPC. DNS (`{slug}.jeffistores.in` etc.) points at the shared prod EC2 via Route53 A-records. The app's middleware resolves the request `Host` header to a `TenantContext` and forwards `x-tenant-slug` to the route handler; `db.ts` uses that to route queries to the tenant's own RDS instead of the platform DB. Deprovision backs up the DB to S3, deletes RDS + bucket, and clears DNS — a returning owner can restore from the backup on re-onboard.
