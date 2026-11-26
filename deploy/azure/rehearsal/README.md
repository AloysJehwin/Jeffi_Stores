# Phase D: rehearsal tooling

Plan: [`docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md`](../../../docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md), Phase D. Both scripts are a dry run unless given `--apply`. Nothing here has been run.

| File | What it does |
|---|---|
| `common.sh` | Sourced by both. Loads `deploy/k8s/db/lib.sh` with `JEFFI_CLOUD=azure`; adds `--apply`, per-step timings and the safe-mode database helpers. |
| `restore-dump.sh` | Dumps prod RDS `jeffi_stores` (`pg_dump -Fc`, over the core's SSH/SSM tunnel, IAM token) into `~/Documents/db-backups/rehearsal-<stamp>/`, restores it into the Azure Postgres as `app_user` (`--no-owner --no-acl`; extensions and schema grant as the admin), then runs the safe-mode scrub. |
| `rehearse.sh` | Brings the platform up on the Azure core, verifies safe mode, smoke-tests it, creates and deletes a throwaway store, writes the timing report. |
| `safe-mode.sql`, `safe-mode-check.sql` | The database half of safe mode (scrub, and a violation count). |
| `safe-mode.jq`, `safe-env.json` | The manifest half: the kill-switch env, applied to everything the platform scripts render. |

Passwords: the RDS IAM token and the Key Vault passwords go into 0600 `PGPASSFILE`s in private temp dirs (removed on exit). None is in argv, the environment or the output.

## Rehearsal safe mode (always on)

The rehearsal runs the whole platform on a copy of production data with production secrets. It must not reach customers, owners, payment providers or marketplaces. `rehearse.sh` will not go past a failed check. `--no-safe-mode` exists but asks for a typed phrase that `--yes` cannot answer.

**Env switches** on every container the platform scripts render (Deployments, StatefulSets, DaemonSets, CronJobs, Jobs), through the `kubectl` shim:

| Variable | Value | Effect (in code) |
|---|---|---|
| `SMS_DISABLED`, `WHATSAPP_DISABLED` | `true` | default of the SMS/WhatsApp Site Controls flags; `sendByTemplate`, campaign dispatch |
| `MAIL_DISABLED` | `true` | `mail-audit` does not call SES |
| `AMAZON_PUSH_DISABLED`, `GMC_PUSH_DISABLED` | `true` | no pushes to Amazon or Google Merchant |
| `ADSENSE_DISABLED` | `true` | no ads loaded |
| `ENABLE_RAZORPAY`, `ENABLE_UPI` | `false` | defaults of the payment Site Controls flags |
| `IN_PROCESS_CRON` | `false` | the controller's in-app interval scheduler (`instrumentation.ts`) does not start |
| `POOL_AUTOSCALE_ENABLED` | `false` | pool autoscale stays in dry-run |
| `REHEARSAL_SAFE_MODE` | `true` | a marker |

The code reads these as `=== 'true'`, so the value is `true`, not `1`. The grep over `packages/store-core`, `messaging-service`, `controller-service` and the other apps found no other `*_DISABLED`, dry-run or kill-switch variable. **There is no env switch** for push notifications, Google Ads uploads, Razorpay calls, Delhivery, Flipkart/Myntra/AJIO, or voice and outreach calls. They are covered by the CronJobs, the database scrub and the credential blanking below, not by a flag.

**CronJobs:** every CronJob is rendered `suspend: true` and the run fails if one is not (`verify_cronjobs`). Scheduling is gated by `IN_PROCESS_CRON=false` (the in-app loop) plus the CronJobs; there is no `CRON_DISABLED`. With the CronJobs off, the provisioning worker is off too, so the store round trip advances its one tenant through `/api/internal/provisioning/advance`. `ecr-refresh` is suspended as well: the script runs it once from the CronJob, and the pull secret expires after about 12 hours.

**Pods:** messaging-service, document-service and voice-service (and their edge copies) are rendered at 0 replicas; smoke skips them. After the rollout, `verify_pods` fails the run if any running pod in `jeffi` or `jeffi-edge` lacks a switch.

**Database (the Azure copy only; `db_guard` refuses to run against anything that is not the Azure Postgres)**, right after the restore and again before the platform starts. Tables and columns that do not exist are skipped with a notice:

| What | Change |
|---|---|
| `site_settings` | `feature_sms_enabled`, `feature_whatsapp_enabled`, `feature_push_enabled`, `feature_marketing_push_enabled`, `feature_birthday_enabled`, `feature_agent_whatsapp_enabled`, `feature_razorpay_enabled`, `feature_upi_enabled`, `feature_subscriptions_enabled`, `feature_reply_auto_apply` set to `false` (inserted if missing) |
| `site_settings` | rows whose key looks like a credential or endpoint (token, secret, api key, `_key`, `key_id`, webhook, password, private key, credential, access key, refresh, callback) set to NULL |
| `tenant_integration_credentials`, `tenant_social_accounts` | tokens emptied, status `revoked` |
| `scheduled_social_posts` | `pending`/`publishing` set to `failed` |
| `push_devices`, `push_queue` | deleted |
| `campaigns` | `enabled = false` |
| `email_campaigns` | `scheduled`/`sending`/`active`/`queued` set to `draft` |
| `email_campaign_logs` | `deferred` set to `skipped` |
| `messages`, `bulk_jobs`, `bulk_job_items` | `queued`/`running`/`pending` set to `cancelled` |
| `outreach_program_state` | `enabled = false` |
| `provisioning_jobs` | `pending`/`running` set to `failed` |

Stores' own databases are on AWS and are not part of this copy, so there is no per-store `site_settings` to change; only the platform's own store lives in the flagship database. The throwaway store is new and holds no customer data.

`safe-mode-check.sql` must report 0 violations before the platform is applied.

## Prerequisites

1. Postgres `jeffi-prod-pg` created (waits on the Microsoft quota) and `deploy/azure/pg-init.sh --apply` done.
2. Kubeconfig at `~/.kube/jeffi-azure.yaml`; IRSA (README step 7) and the overlay values (step 8) done. `CLUSTER_INGRESS_IP` is a REPLACE_ME until the AWS edge exists: pass `--ingress-ip <ip>` for the rehearsal.
3. `az login`, AWS credentials, Tailscale up and accepting routes. `jq` installed.
4. For `--restore` or `restore-dump.sh`: docker running, and the core's SSH key or `session-manager-plugin`.
5. For `rehearse.sh --apply`: `certs/ca-cert.pem` and friends in the repo root (`secrets.sh`); for the store round trip, a file with an administrator's `Cookie: ...` header line.

## Order

```bash
bash deploy/azure/rehearsal/restore-dump.sh                  # dry run
bash deploy/azure/rehearsal/restore-dump.sh --apply          # dump + restore + scrub (--reset on a second run)
bash deploy/azure/rehearsal/rehearse.sh --ingress-ip <ip>    # dry run: checks and the render preview
bash deploy/azure/rehearsal/rehearse.sh --apply --restore --admin-cookie-file ~/admin.cookie --ingress-ip <ip>
```

`restore-dump.sh` flags: `--target-db` (default `jeffi_stores`), `--dump FILE`, `--dump-only`, `--reset`, `--jobs N`, `--scrub-only`.

`rehearse.sh` steps, each timed:

1. `--restore`: `restore-dump.sh --apply` (restore + scrub), then `release-db.sh --cloud=azure`.
2. Scrub and check the database again, then `secrets.sh`, `apply-platform.sh <tag>` and `rollout.sh <tag> platform` with `JEFFI_CLOUD=azure`, the wildcard certificate, then the CronJob and pod verification. The shim is first on `PATH` for these scripts only; it runs `kubectl kustomize` output through `safe-mode.jq`.
3. `smoke.sh`, once per service, connecting to the Azure IP (`SMOKE_CONNECT_TO`).
4. Store round trip (unless `--skip-store`): inserts the tenant rows the way `createTenant()` does, advances that tenant's job through the controller's advance route, smoke-tests the store, then calls the admin deprovision route and checks the tenant namespace is gone. `--keep-store` skips the delete. The typed confirmation names the AWS node, volume and Route 53 records.

## Hostnames

The apps hold `jeffistores.in` in code, so the rehearsal keeps the **production hostnames** and never goes through DNS: smoke and the admin calls connect straight to the Azure ingress IP (`curl --connect-to`). No production A, CNAME or alias record is touched. The wildcard certificate is issued by DNS-01, which writes a temporary `_acme-challenge` TXT record in the Route 53 zone (the script asks first). Let's Encrypt limits identical certificates per week, so avoid repeated platform applies.

To look at it in a browser, put `<Azure IP> ecom.jeffistores.in admin.jeffistores.in ...` in your hosts file.

`--rewrite-hosts` (opt-in) renders `<app>.<domain>` (default `az-rehearsal.jeffistores.in`; `oidc.`, `wif-voice.`, `origin.` and `@jeffistores.in` kept) and smokes a copy of `smoke.sh` with the same rewrite. `--with-dns` then creates A records for `<domain>` and `*.<domain>` (new names only; the rollback batch is saved to `~/Documents/db-backups/route53-rehearsal-rollback-<stamp>.json`). Apps that hard-code the production host may misbehave under it.

## What to look at in the report

`~/Documents/db-backups/rehearsal-<date>.log` (appended per run; the timing table is at the end).

- **Safe mode:** the `safe-mode:` lines (rows changed per table), `database copy: 0 violations`, `all N CronJobs suspended`, `all N running pods carry the switches`.
- **Timings:** `dump`, `restore`, `safe-mode-db`, `release-db`, `apply-platform`, `rollout-platform`, `wildcard-certificate`, `store-provision`, `store-delete`. Phase E needs dump + restore + release-db + rollout.
- **restore log:** `restore-jeffi_stores.log` beside the dump. Missing-role or extension lines are expected; a table, index or constraint error is not.
- **Smoke:** no `FAIL`. The store check hits the store host through the Azure IP; if store routes live only on the AWS edge it fails for that reason.
- **Store round trip:** per-step time from `provisioning_jobs`, and no leftover namespace, EC2 node or EBS volume (the last command printed checks EC2).

## Caveats

- Production secrets are copied into the cluster by `secrets.sh`, so Razorpay, Delhivery, marketplace and Google credentials are present in the pods. Nothing here blocks them by flag; the database blanking, suspended CronJobs and the absence of traffic are what keep them quiet. Treat a manual call to those paths on the rehearsal cluster as live.
- The scrub's status values (for example `email_campaigns` `scheduled`/`sending`) and the tenant insert follow the code as read; a name that does not exist is skipped with a notice, a new required `tenants` column fails the insert before anything is built.
- The rehearsal applies to the real Azure cluster. The Phase E release re-applies the manifests without the switches, suspended CronJobs and parked services; unsuspend and re-scale are part of that release, not of this tooling.
