# Go-live runbook: service pods, controller-service, control-plane merge

_2026-10-14. The release after `5c4ffbf4` (live as of 2026-10-09). Run every command from the repo root on the Mac.
Every script that writes shows its plan, asks for `yes`, and has `--dry-run`._

## One command

```bash
bash deploy/k8s/go-live.sh --dry-run    # read-only preview of every step
bash deploy/k8s/go-live.sh              # everything below, start to finish
bash deploy/k8s/go-live.sh --from <n>   # resume after fixing a failed step
```

It runs the day-before work with the site up: preflight, image build, a rehearsal on a fresh dump. Then it asks once
(type `go-live`) and runs window steps 1–12. It stops at the first failure with that step's rollback and the resume
command, and logs to `~/Documents/db-backups/go-live-<stamp>/`. `--skip-rehearsal` skips the rehearsal.

## What changes

- **Pods.** The platform runs `jeffi-stores-{controller,storefront,admin,business,messaging,document,public-api,mobile}-service`
  in `jeffi`. Each store tenant runs `{slug}-{storefront,admin,business,messaging,document}-service` in `tenant-{slug}`;
  the public API and mobile backend stay shared.
- **Database.** `jeffi_stores` gets this release's schema (42 new tables, new foreign keys) and the control plane, copied
  from `jeffi_control_plane`. That DB is left untouched as the fallback.
- **Secrets.** The four `jeffi/*production` secrets point at `jeffi_stores`. document-service keeps PDFs in a new private
  bucket, `jeffi-stores-documents`.
- **Hosts.** `public.` goes to public-api (`/webhooks/` to messaging). `invoice.`, `quotation.` and `purchaseorder.` go to
  document-service, so their DNS moves from CloudFront to the cluster.
- **Core node.** t4g.large → r7g.medium. The account's EC2 limit is 1 vCPU (it can't be raised until the AWS bill is
  settled) and every T4g size has 2 or more, so none of them starts, t4g.xlarge included. r7g.medium keeps 8 GB and is
  one full Graviton3 core: more sustained CPU than the t4g.large (30% baseline per vCPU), about $10/month less. The pod
  CPU requests are trimmed to fit; the controller runs two pods and updates them one at a time.

| Script | Does |
|---|---|
| `deploy/k8s/bootstrap/freeze.sh on\|off` | Suspends the CronJobs and scales the app Deployments to 0; `off` restores what it recorded |
| `deploy/k8s/db/00-backup.sh` | RDS snapshot, plus `pg_dump` of `jeffi_stores` and `jeffi_control_plane` |
| `deploy/k8s/db/rehearse.sh <dir>` | Restores those dumps locally and runs 10, 20 and `verify.sql` on the copy (no RDS writes) |
| `deploy/k8s/db/10-platform-schema.sh` | First `05-table-owner.sh`, then the additive schema diff in one transaction, then `manual.sql` (foreign keys, one column change) |
| `deploy/k8s/db/05-table-owner.sh` | As the master user: the older tables owned by `postgres` go to a new role `jeffi_owner` (members `postgres` and `app_user`), so `app_user` can alter them. Writes a rollback file |
| `deploy/k8s/db/20-merge-control-plane.sh` | Creates the control-plane tables in `jeffi_stores`, copies the rows, validates the foreign keys, seeds plans |
| `deploy/k8s/db/30-secrets.sh` | Patches only the DB keys, the bucket and `SERVICE_AUTH_SECRET`; creates the bucket; writes a rollback file |
| `deploy/k8s/bootstrap/release.sh` | Builds and pushes the eight images, then `rollout.sh`: platform, tenant schema fan-out (`db/40-tenant-fanout.sh`), every store (moving each off the old all-in-one app), smoke test |
| `deploy/k8s/db/50-seeds.sh` | Seeds the platform's message-template catalog (existing templates are skipped), brings unedited emails up to the catalog and moves stored WhatsApp bodies to `{{brand_name}}` (idempotent; every release runs it after the rollout) |
| `deploy/k8s/bootstrap/doc-hosts-dns.sh` | Points the three document hosts at the cluster; writes a rollback change batch |
| `deploy/k8s/db/verify.sql` | Post-release checks |

DB scripts connect as `app_user` (IAM, the owner of the app tables) through an SSH tunnel via the core node, and write
to `~/Documents/db-backups/release-<stamp>/`.

## The day before

1. Commit, then build and push the images (30–45 min): `bash deploy/k8s/bootstrap/release.sh --build-only`.
2. Back up and rehearse:
   - `bash deploy/k8s/db/00-backup.sh`. It prints its folder.
   - `bash deploy/k8s/db/rehearse.sh ~/Documents/db-backups/release-<stamp>`.
   - Expect: "0 statement(s) left besides the CHECK re-adds", source and target row counts equal (plans and
     plan_features grow from the seed), and `verify.sql` listing no missing tables and no unvalidated foreign keys.
     Restore errors for RDS-only extensions are fine.
3. Read-only dry runs: `bash deploy/k8s/db/30-secrets.sh --dry-run` and `bash deploy/k8s/bootstrap/doc-hosts-dns.sh`.
4. Check the manifests against the cluster: `kubectl kustomize deploy/k8s/platform | kubectl apply --dry-run=server -f - >/dev/null && echo ok`.
5. Checks:
   - No EventBridge schedule stops RDS or the core node during the window: `aws scheduler list-schedules --query 'Schedules[].[Name,State]' --output table`.
   - The `RAZORPAY_PLAN_ID_*` plans in Razorpay match the prices in the rehearsal's plans table.
   - At least 15 GB free disk, Docker Desktop running, `~/.ssh/jeffi-stores-key.pem` present, and `aws sts get-caller-identity` working.
   - The RDS master login works (step 4 hands the older tables over as `postgres`; `go-live.sh` checks it). If RDS
     rejects the password stored in `jeffi/production`, reset RDS to it. There's no downtime: the apps sign in as
     `app_user` with IAM.
     ```bash
     aws rds modify-db-instance --db-instance-identifier jeffi-stores-db --apply-immediately --master-user-password "$(aws secretsmanager get-secret-value --secret-id jeffi/production --query SecretString --output text | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["RDS_MASTER_PASSWORD"])')" --query DBInstance.DBInstanceStatus --output text
     bash -c 'source deploy/k8s/db/lib.sh; tunnel; for i in $(seq 30); do psql_master jeffi_stores -Atc "select 1" >/dev/null 2>&1 && { echo master login ok; exit 0; }; sleep 10; done; echo still rejected; exit 1'
     ```

## The window (60–90 min)

`kubectl get nodes` first. If it fails, open the tunnel: `ssh -i ~/.ssh/jeffi-stores-key.pem -f -N -L 16443:127.0.0.1:6443 ec2-user@32.196.38.130`.

1. **Freeze.** `bash deploy/k8s/bootstrap/freeze.sh on`. The site is down from here.
2. **Back up.** `bash deploy/k8s/db/00-backup.sh` (5–10 min). Note the folder.
3. **Core node** (about 10 min). Only a type within the account's vCPU limit starts (`aws service-quotas
   get-service-quota --service-code ec2 --quota-code L-1216C47A`, 1 today), so r7g.medium. `go-live.sh` checks the
   limit before it stops anything, and starts a stopped core.
   ```bash
   ID=$(aws ec2 describe-addresses --public-ips 32.196.38.130 --query 'Addresses[0].InstanceId' --output text)
   aws ec2 stop-instances --instance-ids $ID >/dev/null && aws ec2 wait instance-stopped --instance-ids $ID
   aws ec2 modify-instance-attribute --instance-id $ID --instance-type '{"Value":"r7g.medium"}'
   aws ec2 start-instances --instance-ids $ID >/dev/null && aws ec2 wait instance-status-ok --instance-ids $ID
   pkill -f 'ssh .*-L 16443:'; pkill -f 'ssh .*-L 15432:'
   ssh -i ~/.ssh/jeffi-stores-key.pem -f -N -L 16443:127.0.0.1:6443 ec2-user@32.196.38.130
   kubectl get nodes; kubectl get pods -A | grep -vE 'Running|Completed'
   kubectl describe node core | sed -n '/Allocated resources/,/Events/p'
   ```
   Go on once the core is `Ready` and the system pods run. The frozen apps stay at 0. CPU requests should be at most
   about 50%: the release adds about 0.4 vCPU, and rolling updates and CronJob pods need the rest.
4. **Schema.** `bash deploy/k8s/db/10-platform-schema.sh`. It first hands the ~90 older tables owned by `postgres` to
   `jeffi_owner` (otherwise `app_user` can't alter them). Review the diff, type `yes`, and expect "0 statement(s) left
   besides the CHECK re-adds".
5. **Control-plane merge.** `bash deploy/k8s/db/20-merge-control-plane.sh`. It stops if any control-plane table already
   exists in `jeffi_stores`.
6. **Secrets and bucket.** `bash deploy/k8s/db/30-secrets.sh`. Keep the rollback file it names. Then
   `bash deploy/k8s/bootstrap/service-secrets-iam.sh`: the pods read secrets with the core's role, which must list the
   three service secrets, or those pods crash at start (`not authorized to perform: secretsmanager:GetSecretValue`).
7. **Release.** `bash deploy/k8s/bootstrap/release.sh`. The images are already in ECR, so it goes straight to the rollout:
   - applies the platform and waits for its four Deployments;
   - deletes the old `flagship` objects;
   - fans the schema out to every store database;
   - re-applies every store (three pods each), stopping at the first that fails;
   - smoke-tests the apex commit, the platform hosts, `public.` and each store.
8. **Seeds.** `bash deploy/k8s/db/50-seeds.sh`.
9. **Document hosts.** `bash deploy/k8s/bootstrap/doc-hosts-dns.sh --apply`. Once the hosts resolve to 32.196.38.130
   (TTL 300): `curl -s https://invoice.jeffistores.in/healthz`.
10. **Pool capacity.** Each Basic store is now three pods. Dedicated pool nodes go to 4; the core keeps its own label:
    `kubectl label node -l 'jeffi.io/pool=basic,!node-role.kubernetes.io/control-plane' jeffi.io/pool-capacity=4 --overwrite`.
11. **Verify.**
    - `bash -c 'source deploy/k8s/db/lib.sh; tunnel; psql_app jeffi_stores -f deploy/k8s/db/verify.sql'`. Expect no
      missing tables, no unvalidated foreign keys, the platform templates seeded, and a `tenant_migration_runs` row per store.
    - By hand: admin sign-in, a checkout (it drafts an invoice), an invoice page, and a test email and SMS from the admin.
12. **Unfreeze.** `bash deploy/k8s/bootstrap/freeze.sh off`. It resumes the CronJobs; the old app Deployments are gone.
    `/api/admin/cron/status` shows runs after the next tick.

## Rollback

| Failed at | Do |
|---|---|
| 1–3 | `freeze.sh off`. The core stays r7g.medium: the t4g.large (2 vCPUs) can't start under the limit. |
| 4 schema | The diff is one transaction, so a failure applies nothing. `manual.sql` is idempotent: fix and re-run. To hand the older tables back: `table-owner-rollback.sql`, run as `postgres`. |
| 5 merge | The row copy is one transaction. If the tables were created but the copy failed, drop the control-plane tables the script listed from `jeffi_stores` and re-run. |
| 6 secrets | `bash ~/Documents/db-backups/release-<stamp>/secrets-rollback.sh` |
| 7 platform not ready | `rollout.sh` stops before deleting `flagship`. Delete the new routes: `kubectl -n jeffi delete ingressroute jeffi-stores-controller-service jeffi-stores-controller-service-admin jeffi-stores-controller-service-cloudfront-origin jeffi-stores-document-service jeffi-stores-public-api-service`. Then `freeze.sh off` brings the old flagship back. It reads the merged control plane, which is fine; or roll the secrets back too. |
| 7 a store | Look at `kubectl -n tenant-<slug> get pods` and `logs deploy/<slug>-controller-service`, fix, and re-run `release.sh`. It is idempotent: built images are skipped, and tenants already at this commit skip the fan-out. |
| 9 DNS | `aws route53 change-resource-record-sets` with the `rollback.json` the script printed. |
| Data | Restore the snapshot to a new instance: `aws rds restore-db-instance-from-db-snapshot`. Then either swap names, or point `RDS_HOST`/`CONTROL_PLANE_RDS_HOST` and the service DB URLs at it. |

Once stores and the platform have written to `jeffi_stores`, don't roll the secrets back to `jeffi_control_plane`: it no
longer has those writes.

## After

- Keep `jeffi_control_plane` for a week, then drop it.
- The old `jeffi-stores` ECR repository (single image) and the stopped EC2 `i-0b2466b2a540d6f23` can go too.
- Every later release runs in GitHub Actions: merging to `main` builds the images and pauses on the `production`
  environment; approved, it applies the `jeffi_stores` schema (when `database/` changed) and pending migration
  files, rolls out, and fans both out to every store's database. Foreign keys and column changes the diff never
  applies go in `deploy/k8s/db/manual.sql`. Setup, dry runs and the Mac fallback: `deploy/k8s/README.md`, Releasing.
- `MESSAGING_INLINE` is unchanged: the controller still sends some messages itself.
- The one-vCPU core holds the platform with little to spare. Check `kubectl describe node core` before onboarding a
  store (three more pods). Once the bill is settled and the limit raised: t4g.xlarge (step 3 with that type), then the
  controller back to a 300m request and 2→4 autoscaling, and the other requests as they were.
