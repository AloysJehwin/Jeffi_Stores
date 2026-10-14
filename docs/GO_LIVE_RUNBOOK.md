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

- **Pods.** The platform runs `jeffi-stores-{controller,messaging,document,public-api}-service` in `jeffi`. Each store
  tenant runs `{slug}-{controller,messaging,document}-service` in `tenant-{slug}`; the public API stays shared.
- **Database.** `jeffi_stores` gets this release's schema (42 new tables, new foreign keys) and the control plane, copied
  from `jeffi_control_plane`. That DB is left untouched as the fallback.
- **Secrets.** The four `jeffi/*production` secrets point at `jeffi_stores`. document-service keeps PDFs in a new private
  bucket, `jeffi-stores-documents`.
- **Hosts.** `public.` goes to public-api (`/webhooks/` to messaging). `invoice.`, `quotation.` and `purchaseorder.` go to
  document-service, so their DNS moves from CloudFront to the cluster.
- **Core node.** t4g.large → t4g.xlarge (about $49/month more).

| Script | Does |
|---|---|
| `deploy/k8s/bootstrap/freeze.sh on\|off` | Suspends the CronJobs and scales the app Deployments to 0; `off` restores what it recorded |
| `deploy/k8s/db/00-backup.sh` | RDS snapshot, plus `pg_dump` of `jeffi_stores` and `jeffi_control_plane` |
| `deploy/k8s/db/rehearse.sh <dir>` | Restores those dumps locally and runs 10, 20 and `verify.sql` on the copy (no RDS writes) |
| `deploy/k8s/db/10-platform-schema.sh` | Additive schema diff in one transaction, then `manual.sql` (foreign keys, one column change) |
| `deploy/k8s/db/20-merge-control-plane.sh` | Creates the control-plane tables in `jeffi_stores`, copies the rows, validates the foreign keys, seeds plans |
| `deploy/k8s/db/30-secrets.sh` | Patches only the DB keys, the bucket and `SERVICE_AUTH_SECRET`; creates the bucket; writes a rollback file |
| `deploy/k8s/bootstrap/release.sh` | Builds and pushes the four images, then `rollout.sh`: platform, tenant schema fan-out (`db/40-tenant-fanout.sh`), every store, smoke test |
| `deploy/k8s/db/50-seeds.sh` | Seeds the platform's message-template catalog (existing templates are skipped) |
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

## The window (60–90 min)

`kubectl get nodes` first. If it fails, open the tunnel: `ssh -i ~/.ssh/jeffi-stores-key.pem -f -N -L 16443:127.0.0.1:6443 ec2-user@32.196.38.130`.

1. **Freeze.** `bash deploy/k8s/bootstrap/freeze.sh on`. The site is down from here.
2. **Back up.** `bash deploy/k8s/db/00-backup.sh` (5–10 min). Note the folder.
3. **Resize the core node** (about 10 min):
   ```bash
   ID=$(aws ec2 describe-addresses --public-ips 32.196.38.130 --query 'Addresses[0].InstanceId' --output text)
   aws ec2 stop-instances --instance-ids $ID >/dev/null && aws ec2 wait instance-stopped --instance-ids $ID
   aws ec2 modify-instance-attribute --instance-id $ID --instance-type '{"Value":"t4g.xlarge"}'
   aws ec2 start-instances --instance-ids $ID >/dev/null && aws ec2 wait instance-status-ok --instance-ids $ID
   pkill -f 'ssh .*-L 16443:'; pkill -f 'ssh .*-L 15432:'
   ssh -i ~/.ssh/jeffi-stores-key.pem -f -N -L 16443:127.0.0.1:6443 ec2-user@32.196.38.130
   kubectl get nodes; kubectl get pods -A | grep -vE 'Running|Completed'
   ```
   Go on once the core is `Ready` and the system pods run. The frozen apps stay at 0.
4. **Schema.** `bash deploy/k8s/db/10-platform-schema.sh`. Review the diff, type `yes`, and expect "0 statement(s) left
   besides the CHECK re-adds".
5. **Control-plane merge.** `bash deploy/k8s/db/20-merge-control-plane.sh`. It stops if any control-plane table already
   exists in `jeffi_stores`.
6. **Secrets and bucket.** `bash deploy/k8s/db/30-secrets.sh`. Keep the rollback file it names.
7. **Release.** `bash deploy/k8s/bootstrap/release.sh`. The images are already in ECR, so it goes straight to the rollout:
   - applies the platform and waits for its four Deployments;
   - deletes the old `flagship` objects;
   - fans the schema out to every store database;
   - re-applies every store (three pods each), stopping at the first that fails;
   - smoke-tests the apex commit, the platform hosts, `public.` and each store.
8. **Seeds.** `bash deploy/k8s/db/50-seeds.sh`.
9. **Document hosts.** `bash deploy/k8s/bootstrap/doc-hosts-dns.sh --apply`. Once the hosts resolve to 32.196.38.130
   (TTL 300): `curl -s https://invoice.jeffistores.in/healthz`.
10. **Pool capacity.** Each Basic store is now three pods: `kubectl label node -l jeffi.io/pool=basic jeffi.io/pool-capacity=4 --overwrite`.
11. **Verify.**
    - `bash -c 'source deploy/k8s/db/lib.sh; tunnel; psql_app jeffi_stores -f deploy/k8s/db/verify.sql'`. Expect no
      missing tables, no unvalidated foreign keys, the platform templates seeded, and a `tenant_migration_runs` row per store.
    - By hand: admin sign-in, a checkout (it drafts an invoice), an invoice page, and a test email and SMS from the admin.
12. **Unfreeze.** `bash deploy/k8s/bootstrap/freeze.sh off`. It resumes the CronJobs; the old app Deployments are gone.
    `/api/admin/cron/status` shows runs after the next tick.

## Rollback

| Failed at | Do |
|---|---|
| 1–3 | `freeze.sh off`. For the node, resize back to t4g.large the same way. |
| 4 schema | The diff is one transaction, so a failure applies nothing. `manual.sql` is idempotent: fix and re-run. |
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
- Every later release is just `release.sh`. Run `10-platform-schema.sh` first when `database/*.sql` changed, and
  `manual.sql`-style statements for foreign keys or column changes the diff never applies.
- `MESSAGING_INLINE` is unchanged: the controller still sends some messages itself.
