# SaaS Multi-Tenant Foundation — Status Summary
_Last updated: 2026-08-18_

Branch: `feat/multitenant-foundation` → **PR #425** (open, do NOT merge until instructed)

> **This is the authoritative status doc for the multi-tenant effort.** It SUPERSEDES the
> earlier design docs, which were written before any code existed and still describe the work
> as unstarted:
> `SAAS_MULTITENANT_PLAN.md` ("No code written yet"), `MULTI_TENANT_PHASES.md` (Phases 0–5
> "not started"), `PROVISIONING_ENGINE_PLAN.md` ("Design for review, no code"),
> `PROXY_ASG_PLAN.md` (flags `/api/health` debt that is already fixed — readiness now lives at
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
| 🔴 **2** | **Configure the provisioning driver** | **Built + committed** (`c0c8e5b7`): `.github/workflows/provisioning-drive.yml` + `.github/scripts/provisioning-drive.sh` (multi-stage: preflight → drive → verify → report, plus an hourly drift sweep). **Config is DONE (2026-08-18):** repo secret `CRON_SECRET` set from Secrets Manager `jeffi/production` (64 chars, authoritative source), repo var `APP_URL=https://jeffistores.in`. ⚠️ **Still blocked by item 1, for two independent reasons:** (a) preflight returns **404** — `/api/cron/provisioning-worker` is not deployed until PR #425 ships; (b) GitHub refuses `workflow_dispatch` for a workflow *"not found on the default branch"*, so it is not runnable until the workflow reaches `main`. Merging PR #425 clears both at once. |
| | *Verified 2026-08-18 (local run of the same script)* | `/api/ready` → 200. Sibling cron routes (`compute-health`, `sweep-auto-tasks`) → **401** on a bad token while `provisioning-worker` → **404**, confirming the preflight's deployed-vs-not discrimination is accurate rather than a false alarm. CloudFront `/api/*` uses **Managed-AllViewer** (forwards `Authorization`) + **Managed-CachingDisabled**, so `jeffistores.in` is a safe driver host — a caching or header-stripping policy there would have made the endpoint 401 forever. All six guard clauses (missing/plaintext URL, bad + out-of-range minutes, empty secret, unreachable host) fire correctly. |
| | *Why a workflow and not an EC2 crontab* | Provisioning is **operator-gated** — the only enqueue path is `POST /api/admin/ecom/customers/[id]/provision` (super_admin); there is no self-serve provisioning route. So a human is already present when a job starts, and a `workflow_dispatch` driver is sufficient — no need for 1440 scheduled runs/day. Deprovision needs no driver at all (the Razorpay webhook and admin button call `deprovisionTenant()` **inline**). The only thing needing a schedule is `reconcileOrphanedTenants()`, which does not need 60-second resolution → hourly. **If provisioning ever becomes self-serve (auto-provision on payment), this must move to a real 1-min scheduler** — a manual driver would no longer be acceptable. |
| | *Clarification on "in-VPC"* | The VPC constraint applies to **where the code executes, not where the trigger comes from**. The worker is a route on the app, which already runs in-VPC, so its data-plane steps (`load_schema`, `restore_data`, backup) reach the `PubliclyAccessible: false` tenant RDS fine. Any external trigger (GHA, EventBridge, uptime pinger) is therefore viable. Only a driver that runs the provisioning code **itself** outside the VPC (e.g. a standalone runner importing `steps.ts`) would break. |

### Important but not blocking

| # | Item | Notes |
|---|------|-------|
| 🟡 **3** | **Add alerting on failed/stuck provisioning jobs** | Query `provisioning_jobs WHERE status='failed'` or `updated_at < now()-interval '30min' AND status IN ('pending','running')` |
| 🟡 **4** | **Document the deprovision multi-minute reality** | RDS delete takes several minutes; deprovision returns before the DB is actually gone. Operators should know to wait before re-provisioning the same slug. |
| 🟡 **5** | **Wildcard cert renewal is now a fleet-wide SPOF** | Cert expires **2026-11-15**. Every tenant's HTTPS depends on it. Wildcards need DNS-01, so certbot auto-renew must retain working `dns-route53` creds on the box — a silent renewal failure takes down *all* tenants at once. Verify `certbot renew --dry-run` + add an expiry alert. |
| 🟡 **6** | **Release the idle EIP `32.196.38.130`** | The old (pre-EIP-swap) address is still allocated and **unassociated** — AWS bills idle EIPs (~$3.60/mo). Three other EIPs are attached to non-instance ENIs and are worth an audit at the same time. |
| 🟡 **7** | **`deploy/aws-infrastructure.yaml` still documents the dead IP** | `32.196.38.130` appears in 4 places incl. `EC2_HOST`. Verified **not consumed by any tooling** (doc-only, so nothing breaks) — but it's the file an operator would trust mid-incident. Update to `52.20.193.62`. |
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

Each signed-up tenant gets a dedicated `db.t4g.micro` RDS Postgres instance + an S3 bucket, provisioned by a 12-step state machine (`steps.ts`) driven by an in-VPC cron worker. DNS (`{slug}.jeffistores.in` etc.) points at the shared prod EC2 via Route53 A-records. The app's middleware resolves the request `Host` header to a `TenantContext` and forwards `x-tenant-slug` to the route handler; `db.ts` uses that to route queries to the tenant's own RDS instead of the platform DB. Deprovision backs up the DB to S3, deletes RDS + bucket, and clears DNS — a returning owner can restore from the backup on re-onboard.
