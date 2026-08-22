# Session Handover — 2026-08-17

> ⚠️ **PARTIALLY OUT OF DATE — corrected 2026-08-18.** Work continued after this was written:
> everything below was **committed and pushed**, five more commits landed, and the test tenant was
> torn down. Corrections are inline below, marked **[UPDATE 08-18]**.
> **Authoritative current status: [`docs/SAAS_MULTITENANT_STATUS.md`](./SAAS_MULTITENANT_STATUS.md).**

## What Was Being Worked On
Converting the single-tenant Jeffi Stores e-commerce platform into a multi-tenant SaaS
(`ecom.jeffistores.in`). This session: Razorpay Route (POBO) payments, per-plan feature
gating, onboarding emails, store-owner admin provisioning, custom domains, migration
fan-out, COD settlement, and a real AWS provisioning provider. Next up (NOT started):
**live AWS provisioning verification + deprovision-with-backup/restore.**

## Branch & Uncommitted State
- Branch: `feat/multitenant-foundation` (NEVER merge to main; open PR only, don't merge until user says)
- ~~**Everything this session is UNCOMMITTED** — ~30 modified files + ~27 new files/dirs~~
  **[UPDATE 08-18]** All committed and pushed. Working tree is **clean**. Now tracked as **PR #425 (open)**.
- Typecheck is clean (`npx tsc --noEmit` passes)

## Environment
- Control-plane DB: `jeffi_control_plane` (local port 5432, user I578432)
- App DB: `jeffi_production_ready` (local port 5432)
- **ecom data was CLEARED** at end of session — 0 tenants/owners (fresh start)
- Razorpay: TEST keys in `.env.local` (`rzp_test_Su5bh0HgD3ySb7`); Route LIVE-approved but Route linked accounts only work with LIVE keys
- Razorpay plan IDs (test) in `.env.local` + Secrets Manager `jeffi/local`
- AWS: account `708835965056`, region `us-east-1`, creds working
- Existing RDS `jeffi-stores-db`: VPC `vpc-04bd02e91e0bc0882`, SG `sg-0e361f0f1b093bd83`, subnet group `default`, pg16, IAM auth ON, class db.t4g.small
- S3 bucket: `jeffi-stores-bucket`; RDS cert present at `certs/global-bundle.pem`

## COST WARNING
- LLM proxy DAILY limit €110, at €100.05 (91%) — ~€10 headroom. Monthly €100 only 7% used.
- Big cost driver = cache-read tokens from this long session's accumulated context.
- **Recommend /clear before resuming** to drop context; all code is on-disk.

## What Was Completed This Session
- **Razorpay Route (POBO)**: `src/lib/razorpay-route.ts` — createLinkedAccount, transferToLinkedAccount (3% commission), reverseTransfer, recordCodSettlement
- **Bank verification**: switched to Razorpay FAV (instant, `src/lib/bank-verify.ts`) — no RazorpayX/UTR
- **KYC approval** (`src/app/api/admin/ecom/kyc/[tenantId]/approve/route.ts`): creates Route linked account + subscription + approval email
- **Payment split**: `fireRouteTransfer()` in `src/app/api/razorpay/verify/route.ts`
- **Store-owner admin**: `src/lib/tenant-admin-provision.ts` — on subscription.charged, creates super_admin + mTLS cert in tenant DB, emails cert
- **Onboarding emails**: `src/lib/ecom-emails.ts` (KYC submitted/approved/rejected, payment confirmed, store live)
- **Per-tenant emails**: generated columns `noreply-{slug}@` / `campaigns-{slug}@` on tenants
- **Plan gating**: `src/lib/plan-gate.ts`. Basic scopes fixed. Product form hides inventory flags; brand form hides returns policy; WhatsApp gated to crm:read; ecom admin section blocked on tenant subdomains; SMS/WhatsApp toggles in site settings (Growth+)
- **Storefront Google auth**: `src/lib/google-oauth-popup.ts` strips ANY jeffistores.in subdomain (fixes tenant `{slug}.` OAuth)
- **Migration fan-out**: `src/lib/tenant-migrations.ts` + `tenant-migrations-schema.ts` + `POST /api/admin/ecom/migrations/run`
- **Custom domains**: `tenant_custom_domains` table, `src/app/api/ecom/domains/*`, `CustomDomains.tsx` UI, DNS CNAME verify
- **COD settlement**: ledger-based via `recordCodSettlement`, real Delhivery charge correction
- **AWS provisioning provider**: `src/lib/provisioning/aws-provider.ts` (real @aws-sdk RDS/S3), enabled via `PROVISIONING_PROVIDER=aws`; installed `@aws-sdk/client-rds`

## What Needs To Be Done Next (ordered)

> **[UPDATE 08-18]** All four items below are DONE. The *current* next steps are (1) merge PR #425
> and (2) **schedule the cron worker — it is scheduled nowhere today**, so enqueued jobs never
> advance. See `docs/SAAS_MULTITENANT_STATUS.md` for the live pending list.

1. **Live AWS provisioning test** — ✅ DONE (2026-08-17). Real `db.t4g.micro` (`jeffi-tenant-test`,
   pg 16.13, IAM auth, encrypted) provisioned in ~9 min via `AwsProvisioningProvider` from a local
   driver; param group + RDS create + `available` poll all verified against account 708835965056.
   Then torn down (`delete-db-instance --skip-final-snapshot`). **KEY FINDING below.**
2. **Deprovision-with-backup** — ✅ DONE. `deprovisionTenant()` in `provisioning/steps.ts`:
   status→terminated (+clearTenantCache = store offline) → `backupDb` → `putTenantBackup` (S3
   dual owner/slug keys) → delete RDS+bucket → `clearTenantInfra`. Auto-fires on
   `subscription.cancelled`/`completed` in the ecom webhook; manual admin button in `TenantActions`.
   Backup is **pure-JS** (`src/lib/tenant-db-backup.ts`, no pg_dump binary) — round-trip PROVEN
   against local PG (FK order via `session_replication_role=replica`, bytea intact).
3. **Restore-on-re-onboard** — ✅ DONE. `restore_data` step in the state machine (no-op unless the
   job carries `restoreFromKey`). `findLatestBackup({ownerId,slug})` + `/api/ecom/onboard/restore-available`;
   OnboardWizard shows a "we found a backup" banner + opt-in; `provision/route.ts` resolves the key.
4. **Provisioning driver** — ✅ DONE, now EVENT-DRIVEN (reworked 2026-08-22). No cron worker:
   `triggerProvisioning()` (`src/lib/provisioning/trigger.ts`) is the single entry for all 4 flows,
   and for AWS it kicks a self re-invoke loop (`POST /api/internal/provisioning/advance`,
   `Bearer $CRON_SECRET`) that advances one step per tick until done/failed. Only `reconcileOrphanedTenants()`
   is scheduled (hourly, from `instrumentation.ts`). ⚠️ MUST run inside the VPC (see finding).

### ⚠️ CRITICAL FINDING from the live test (blocks real end-to-end)
The RDS instances are `PubliclyAccessible: false` in VPC `vpc-04bd02e91e0bc0882` — reachable ONLY
from inside that VPC. So the **data-plane** steps — `loadSchema`, `backupDb`, `restoreDb` — CANNOT
run from a laptop or any host outside the VPC (they time out). The **control-plane** steps
(param group, create/delete RDS, S3) work from anywhere. Therefore:
- The cron worker / provisioning driver MUST be deployed **in-VPC** (app EC2/ECS, a bastion, or an
  in-VPC Lambda) for `load_schema`/`restore_data` to succeed. This is a deploy/topology decision.
- To run/verify from a laptop: SSH tunnel through the in-VPC app host. VERIFIED WORKING:
  `ssh -f -N -L 5434:<tenant-rds-endpoint>:5432 -i ~/.ssh/jeffi-stores-key.pem ec2-user@52.20.193.62`
  (**[UPDATE 08-18]** IP changed: was `32.196.38.130`, now the stable EIP **`52.20.193.62`**;
  host `jeffi-stores-app` = `i-0b2466b2a540d6f23`, private `172.31.20.170`; SSM is NOT enabled on it).
  The one-time schema load over the tunnel uses `RDS_MASTER_PASSWORD` (IAM token can't be signed for 127.0.0.1).

### ✅ aloys-store fully provisioned on dedicated infra (2026-08-17)
Ran the REAL engine end-to-end (basic plan): RDS `jeffi-tenant-aloys-store`
(`...cjmaa6acimgm.us-east-1.rds.amazonaws.com`) + S3 `jeffi-tenant-aloys-store`, schema loaded
(120 tables), `app_user`+`rds_iam` granted, `tenant_infra` written, status `active`. ~~This RDS is
LIVE and BILLING — deprovision when done testing (admin button, or subscription cancel).~~
**[UPDATE 08-18] RESOLVED — torn down.** `describe-db-instances` shows only `jeffi-stores-db`;
`aloys-store.jeffistores.in` no longer resolves. **No stray tenant billing.**

### 🐛 THREE schema-load bugs fixed in `buildTenantSchemaSql()` (would have broken live too)
`src/lib/tenant-migrations-schema.ts` now: (1) `stripPsqlMetaCommands` drops `\`-prefixed psql
lines (a stray `\unrestrict` from pg_dump broke the `pg` driver); (2) `hoistForeignKeys` moves all
`ADD CONSTRAINT … FOREIGN KEY` to the end (FKs in orders.sql referenced PKs defined later in
constraints.sql → "no unique constraint matching"); (3) dedupes FKs by name + self-guards each
with `DROP CONSTRAINT IF EXISTS` (constraints.sql redefines some FKs → "already exists" after hoist).
Verified: 0 early FK adds, 167 deferred, 0 backslash lines. This same builder feeds both the AWS
`loadSchema` and the migration fan-out, so live is fixed by the same change.

### Minor code note
`aws-provider.ts` uses extensionless dynamic imports (`await import('../tenant-migrations-schema')`,
`'../tenant-db-backup'`, `'../tenant-backup-store'`). Fine under Next.js's bundler (how the app runs),
but they fail under raw Node ESM — the live-test driver had to import schema/backup directly. Consider
adding `.js`/`.ts` extensions if these ever run outside Next.

## Plan File
Live-test + deprovision/backup/restore plan: `/Users/I578432/.claude/plans/cheeky-marinating-walrus.md`.

## Key Decisions
- Bank verify = Razorpay FAV (no RazorpayX in live)
- COD = ledger settlement (no payment_id), not Route transfer
- Backups = pg_dump `.sql.gz` in `jeffi-stores-bucket/tenant-backups/{slug}/`
- Restore = auto-detect on re-onboard
- Route linked accounts need LIVE keys (fail silently in test — approve route continues)
- Full per-plan matrix: `docs/PLAN_FEATURE_MATRIX.md` (+ .docx on Desktop) — KEEP UPDATED

## Important File Paths
- `docs/PLAN_FEATURE_MATRIX.md` — authoritative plan/feature matrix
- `src/lib/provisioning/{aws-provider,stub-provider,steps,provider,index}.ts`
- `database/control-plane/schema.sql`
- `src/lib/{razorpay-route,razorpay-subscriptions,bank-verify,plan-gate,ecom-emails,tenant-admin-provision,tenant-migrations}.ts`

## Known Issues / Gotchas
- Route `accounts.create` fails in TEST mode ("Invalid business type") — LIVE keys only. Code handles gracefully.
- `provision/route.ts` (admin override) + all owner flows route through `triggerProvisioning()`: inline-drives
  for stub; for AWS enqueues + kicks the self re-invoke loop (`/api/internal/provisioning/advance`) that
  advances it. Data-plane steps only work in-VPC (see finding).
- Live-test driver was a throwaway under `scripts/` (removed). RDS reachability = VPC-only.
- graphify graph doesn't index SQL/tenant-registry/middleware — direct reads needed there.
- Clear ecom data to restart: TRUNCATE owner_tenants/tenant_bank_accounts/provisioning_jobs/tenant_transactions/settlement_ledger/tenant_migration_runs/onboarding_drafts/tenant_kyc CASCADE; DELETE FROM tenants; DELETE FROM owners; + DELETE owner sessions from app DB.
