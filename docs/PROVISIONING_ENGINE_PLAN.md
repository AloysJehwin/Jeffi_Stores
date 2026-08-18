# Provisioning Engine + Multi-Tenant Deploy Pipeline — Design

> ⚠️ **SUPERSEDED (2026-08-18).** The status line below ("no code / no live AWS yet") is
> **out of date** — the engine is built (12-step state machine, real AWS provider, live-tested
> end-to-end) on `feat/multitenant-foundation` (PR #425). Current state:
> **`docs/SAAS_MULTITENANT_STATUS.md`**. Design rationale below is still valid; the
> "Build order" and "Open decisions" sections are historical.

> Status: **Design for review. No code / no live AWS yet.** Grounded in live infra IDs + AWS-SDK research (Aug 2026).
> Locked decisions: **RDS-per-tenant**, **shared app fleet** (not per-tenant instances), **auto-migrate all tenant DBs** on a schema change.
> Nothing here provisions real infra until you approve and we execute step-by-step.

---

## 0. Compute & deploy model (the frame for everything below)

| Layer | Model | Consequence |
|---|---|---|
| **App code** | **Shared fleet** — one Next.js app serves all tenants, routing to each tenant's DB per-request via `TenantContext` (already built) | A **code deploy updates every tenant at once** — no per-tenant image fan-out. Existing blue/green is enough. |
| **Database** | **RDS-per-tenant** (dedicated instance each) | Hard data isolation. Provisioning must create real RDS per tenant. Schema changes must fan out to every tenant RDS. |
| **Storage** | Bucket-per-tenant (`jeffi-tenant-{slug}`) | Provisioning creates + locks down a bucket per tenant. |
| **DNS/TLS** | Wildcard `*.jeffistores.in` + wildcard ACM cert already cover `{tenant}.jeffistores.in` | **Zero per-tenant DNS/cert work** for platform subdomains. Only custom domains need ACM. |

So there are **two separate systems** to build:
- **A. Provisioning engine** — makes a new tenant *real* (RDS + bucket + schema → `active`).
- **B. Multi-tenant migration pipeline** — propagates a `main` schema change to *every* tenant RDS.

Code deploy itself is unchanged (shared fleet blue/green).

---

## Part A — Provisioning Engine

### A.1 Why it must be async
`RDS CreateDBInstance` takes **~5–10 minutes**. It **cannot** run in the onboarding HTTP request (would time out). → a **DB-driven state machine** advanced by a worker/cron, exactly like the repo's `scripts/sync-*.mjs` + Cron convention.

### A.2 New control-plane table: `provisioning_jobs`
```
provisioning_jobs (
  id uuid pk, tenant_id uuid, step varchar(32), status varchar(16),   -- pending|running|done|failed
  attempts int default 0, last_error text, created_resources jsonb,    -- for rollback
  created_at, updated_at
)
```
`created_resources` tracks what's been made (secret arn, param group, db instance id, bucket) so a failed run can be **rolled back** (delete orphaned RDS/bucket — else you leak paid infra).

### A.3 The state machine (one step per worker tick, all idempotent/retryable)

| # | Step | AWS SDK call | Idempotency |
|---|---|---|---|
| 1 | `create_param_group` | `CreateDBParameterGroup` (family `postgres16`) + `ModifyDBParameterGroup` (`max_connections`, **conservative — micro RAM is small**, `ApplyMethod: pending-reboot`) | `DBParameterGroupAlreadyExists` = ok |
| 2 | `create_db_instance` | `CreateDBInstanceCommand` — `db.t4g.micro`, `postgres` 16, gp2 20GB, **`PubliclyAccessible: false`**, subnet group `default`, SG `sg-0e361f0f1b093bd83` (VPC `vpc-04bd02e91e0bc0882`), **`EnableIAMDatabaseAuthentication: true`**, the custom param group | `DBInstanceAlreadyExists` = ok |
| 3 | `wait_db_available` | poll `DescribeDBInstances` until `available` (~5–10 min) | pure poll |
| 4 | `load_schema` | connect via **IAM token** (`@aws-sdk/rds-signer`, same as `tenant-registry.ts`), run full desired-state DDL (extensions → tables → constraints → indexes → functions, the `schema-diff.sh` file order) against the **empty** DB (every statement additive), then **`CREATE ROLE app_user … GRANT rds_iam`** | DDL uses `IF NOT EXISTS`; `GRANT` idempotent |
| 5 | `create_bucket` | `CreateBucket` (`jeffi-tenant-{slug}`, no LocationConstraint in us-east-1) + **`PutPublicAccessBlock` (all true)** + `PutBucketCors`. ⚠️ **Do NOT clone the world-writable `s3-bucket-policy.json`** — write/delete restricted to the app IAM principal; public read via CloudFront OAC only. | `BucketAlreadyOwnedByYou` = ok; `BucketAlreadyExists` (other account) = hard fail → fallback name |
| 6 | `write_infra` | `UPDATE tenant_infra` SET rds_endpoint, rds_db=`jeffi_stores`, rds_port=5432, iam_auth=true, s3_bucket, ec2_target=`pool`, region | plain upsert |
| 7 | `activate` | `UPDATE tenants SET status='active'` — flips the host→tenant resolver to serve it | plain |

**No Route53 / ACM steps** for platform subdomains (wildcard covers them). Custom-domain tenants get an optional sub-flow: `RequestCertificate` (DNS-validated) + Route53 record in zone `Z08094881XKVZ9XSGBKG1` + store `cert_arn`/`cloudfront_id`.

### A.4 IAM-auth gotcha (must not miss)
IAM DB auth needs **three** things or the app provisions an instance it can never log into:
1. `EnableIAMDatabaseAuthentication: true` on the instance (step 2)
2. `app_user` role created + `GRANT rds_iam` (step 4)
3. The app's EC2 role has `rds-db:connect` on the new instance's resource ARN (a policy update — per-tenant ARN or a wildcard `dbuser:*/app_user`)

### A.5 Trigger model (per your "vet each tenant" lean)
Onboarding sets `provisioning` + enqueues the job **but** the worker only runs provisioning for jobs an operator **approves** (a button on the admin Customers page) — avoids surprise ₹1,150/mo RDS on every signup and lets you vet. Alternatively auto-run; operator-gated is safer to start.

### A.6 Cost & scheduling reminder
Each tenant RDS ≈ **₹1,150/mo** 24/7. The platform's EventBridge start/stop (cost saving) does **not** apply to paying tenants. Fold into pricing (already validated: ₹4,999 covers it).

### A.7 Test-tenant instance disable (cost-saving, TEST TENANT ONLY)
A manual **Disable / Enable instance** toggle to stop the test tenant's RDS while dogfooding (billing → storage-only, ~₹200/mo vs ~₹1,150).
- **Gated to slug `test` only** — the button renders on the tenant detail page *only* when `tenant.slug === 'test'`, and the API re-checks the slug server-side. A real paying tenant can NEVER be stopped this way (their store must stay up).
- **Disable** = `StopDBInstanceCommand`; **Enable** = `StartDBInstanceCommand` (~5 min to resume). Reflect state in `tenants.status` (e.g. `suspended` when stopped) or a dedicated `instance_state` so the resolver/UI show it.
- ⚠️ **AWS caveat**: a stopped RDS **auto-restarts after 7 days** (AWS-enforced) — fine for test cost-saving, not permanent shutdown.
- Built as part of the provisioning engine (operates on the test tenant's real RDS once provisioning creates it).

---

## Part B — Multi-Tenant Deploy Pipeline (the "ecom pipeline")

### B.1 What changes vs. today
Today's pipeline: build → blue/green deploy to one EC2 → `schema-diff.sh` against **one** RDS. With the shared-fleet model:
- **Code**: unchanged — blue/green deploy of the shared fleet updates all tenants instantly. ✅ nothing to add.
- **Schema**: the new part — `schema-diff` must run against **every active tenant's RDS**, not just the platform one.

### B.2 New CI stage: `schema-diff-all-tenants`
Runs **after** the existing schema-diff (which keeps handling the platform/flagship RDS), only when `database/*.sql` changed:

```
for each tenant in control-plane WHERE status='active':
    resolve its rds_endpoint (+ IAM token)
    run the SAME schema-diff.sh logic (migra diff → additive-only apply) against that tenant RDS
    record result per-tenant (success / failure + error) in a migration_runs table
```

### B.3 Fan-out design (auto-migrate all, per your choice) — with safety
- **Per-tenant tracking**: a `tenant_migration_runs` table (tenant_id, git_sha, status, applied_sql, error, ran_at) so a failure on tenant X doesn't hide behind a green pipeline.
- **Isolation of failure**: one tenant's migration failure **must not** abort the others — collect all results, report a summary ("18/20 migrated, 2 failed: …"), surface failures in the admin Instances/Store Status page.
- **Additive-only** (same guard as `schema-diff.sh`): never auto-apply drops across tenant fleet — destructive changes go through a reviewed migration path.
- **Concurrency cap**: migrate ~5 tenants in parallel (not all N at once) to avoid hammering.
- **Idempotent**: re-running is safe (migra diff = no-op if already applied).

### B.4 Where it runs
Same pattern as today (SSH/SSM to the EC2 box which has RDS reach + the schema files), but looping the tenant registry. As tenant count grows, this becomes a dedicated worker rather than an inline CI step (a 50-tenant migration shouldn't block a deploy) — start inline, move to a queued worker at scale.

### B.5 The honest scaling caveat
Auto-migrating N tenant DBs on every schema change is **O(N) work per deploy** and a real failure surface (one tenant's DB down = one failure to reconcile). At small N it's fine inline; past ~20–30 tenants it should be a **background migration queue** with retry, not a pipeline step. The table + summary design supports moving to that without rework.

---

## Build order (all reversible; design-approved before any live AWS)

1. **`provisioning_jobs` + `tenant_migration_runs` tables** (control-plane, local) — pure schema.
2. **Provisioning worker** (state machine) with **stubbed AWS calls** first → test the flow locally with no real infra.
3. **Wire real AWS calls** one step at a time, each verified (param group → 1 real test RDS → schema load → bucket).
4. **Operator "Provision" button** on admin Customers page.
5. **Migration fan-out** — extend `schema-diff` to loop active tenants + per-tenant result tracking.
6. Only after all verified on one test tenant: open to real tenants.

## Open decisions for you
1. **Provisioning trigger**: operator-approved (vet each, avoid surprise cost) vs auto-on-signup? (Recommend operator-approved.)
2. **Migration fan-out location**: inline CI step now (fine at small N) vs background worker from the start? (Recommend inline now, worker later.)
3. **`max_connections` per tenant micro**: pick a conservative value (we learned 100 OOM'd a micro — 45–60 is safe) — confirm.
4. **S3 policy tightening**: confirm we do NOT replicate the world-writable policy (lock writes to the app IAM principal + CloudFront OAC for reads).

---

*Grounded in: `deploy/aws-infrastructure.yaml` (RDS/VPC/SG/zone/cert IDs), `deploy/schema-diff.sh`, `src/lib/s3.ts`, `src/lib/db.ts` `buildTenantPool`, `src/lib/tenant-registry.ts`, `database/control-plane/schema.sql`, and AWS SDK v3 (`@aws-sdk/client-rds`, `-s3`, `-route-53`, `-acm`) research. Live IDs should be re-verified via `aws` CLI before hardcoding.*
