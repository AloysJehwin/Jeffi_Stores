# k3s platform — runbook

Master plan: `docs/K8S_MIGRATION_PLAN.md`. This folder is everything needed to stand the cluster
up and cut production over to it.

| Path | What |
|---|---|
| `bootstrap/launch-core.sh` | One-time: security groups, RDS ingress, the core `r7g.medium`, as the account's EC2 limit is 1 vCPU (user-data `core-node.sh`), EIP `32.196.38.130` |
| `bootstrap/core-node.sh` | Core user-data: Tailscale + k3s server (embedded etcd, 6-hourly snapshots) |
| `bootstrap/secrets.sh` | Seeds cluster Secrets from Secrets Manager + local `certs/` (prints no values) |
| `bootstrap/store-secret.sh` | Writes `jeffi/store` (storefront, admin and business pods) from `jeffi/production` without the control-plane keys in `store-secret-exclude.txt`; prints no values. Each release runs it (Deploy · prepare), and skips the write when nothing changed. Pods fall back to `jeffi/production` if it is missing |
| `bootstrap/service-secrets-iam.sh` | Lets the core's role read each service's secret and `jeffi/store` |
| `bootstrap/tenant-db-snapshots.sh` | One-time: daily EBS snapshots (keep 7) of every store database disk on the store's own server (tag `jeffi:role=db`). The `node_db_backup` CronJob writes the daily S3 dumps |
| `bootstrap/apply-platform.sh` | Applies `platform/` in dependency order |
| `bootstrap/release.sh` | Builds the eight service images from `HEAD` and pushes them to ECR (`--build-only`), then (`--rollout-only`, after `db/release-db.sh`) runs `rollout.sh`, `smoke.sh` and `db/50-seeds.sh` |
| `bootstrap/rollout.sh` | Rollout: `platform prep`, `platform <service>`, then `stores shared` and `stores <service>` (each store's slice, through the release's controller) |
| `bootstrap/smoke.sh` | Per service: the platform pod's own health check (the Next apps' reporting the release commit), its public host, and the same in every store that runs it |
| `bootstrap/release-job.py` | A one-off Job from a platform Deployment's pod (release image, env, secrets); the DB stage runs the tenant fan-out in the release's controller this way |
| `db/` | Production DB release scripts: `release-db.sh` (`--flagship`, `--tenants`), backup, schema, control-plane merge, secrets, tenant fan-out (`40-tenant-fanout.sh`), seeds; see `docs/GO_LIVE_RUNBOOK.md` |
| `platform/` | Traefik config, cert-manager + wildcard, mTLS edge, the controller/messaging/document/public-api services, Redis, CronJobs, Coroot + Headlamp |
| `gen-cronjobs.ts` | Regenerates `platform/cronjobs.yaml` from `packages/store-core/src/lib/shared/cron-jobs.ts` (a test fails on drift) |

**Crons.** One CronJob per `CRON_JOBS` entry, in `jeffi`. A job with a `tenantScope` (the nightly Google Merchant and
Amazon feed syncs included) calls `POST /api/cron/fanout` on the controller, which runs it for the flagship
(`CRON_FLAGSHIP_BASE`) and every active store whose plan grants the scope, at `CRON_STORE_BASE`
(`{slug}`, `{service}`: the store's `admin-service`, or its old all-in-one `controller-service` for the store
crons that app serves; anything else on it is reported `skipped`). Bases: `controller-service/src/lib/cron/targets.ts`.
Platform jobs call their own route. Runs are recorded in the flagship's `site_settings` (`cron_log_{id}`); the
store's page in the ecom admin (Provisioning tab, Scheduled jobs) shows its last result per job. A new store's
pipeline ends with `connect_crons`: once it is live, the controller calls the store's `GET /api/cron/ping`
exactly as the fan-out will (Host, `CRON_SECRET`) and checks its database, messaging and documents; unreachable
after 5 min and a few retries, it warns and alerts but never rolls back. A `401` there means `jeffi/store` lacks
the controller's `CRON_SECRET`.

Tenant namespaces are **not** in git. The provisioning engine renders them
(`packages/store-core/src/lib/k8s/tenant-workload.ts`) and applies them (`packages/store-core/src/lib/k8s/tenant-compute.ts`) when
`PROVISIONING_COMPUTE=k8s` (set by the `provisioning` ConfigMap).

## Bring-up (in order)

1. **Tailscale auth key.** Create a reusable, tagged, pre-approved auth key and put it in the secret:
   `aws secretsmanager put-secret-value --secret-id jeffi/production/k3s --secret-string "$(aws secretsmanager get-secret-value --secret-id jeffi/production/k3s --query SecretString --output text | jq --arg k "$TSKEY" '.TS_AUTHKEY=$k')"`
2. **Launch the core node:** `bash deploy/k8s/bootstrap/launch-core.sh`. Note the printed node SG id.
3. **Kubeconfig:** `ssh -i ~/.ssh/jeffi-stores-key.pem ec2-user@32.196.38.130 sudo cat /etc/rancher/k3s/k3s.yaml`.
   Set `server:` to the core's Tailscale IP (or `32.196.38.130` from your IP only).
4. **Secrets:** `GH_DEPLOY_TOKEN=… bash deploy/k8s/bootstrap/secrets.sh`
5. **Provisioner config** (from step 2):
   `kubectl -n jeffi patch cm provisioning --type merge -p '{"data":{"K8S_SERVER_URL":"https://<core-private-ip>:6443","K8S_NODE_SECURITY_GROUP":"<node-sg>","K8S_NODE_AMI_ID":"<al2023-arm64-ami>"}}'`
6. **Apply:** `bash deploy/k8s/bootstrap/apply-platform.sh local-<sha>` (images pushed by `release.sh --build-only`)
   - Basic tenants schedule on any node labelled `jeffi.io/pool=basic`, capped per node by `jeffi.io/pool-capacity`. To host them on core: `kubectl label node <core> jeffi.io/pool=basic jeffi.io/pool-capacity=<n> --overwrite`. Core must have no NoSchedule taint (tenant pods carry no tolerations).
7. **Verify before any DNS change**, with `curl --resolve`:
   - `curl --resolve jeffistores.in:443:32.196.38.130 https://jeffistores.in/api/ready`
   - `curl --resolve admin.jeffistores.in:443:32.196.38.130 https://admin.jeffistores.in/` → TLS handshake failure without a cert; works with `--cert certs/client-cert.pem --key certs/client-key.pem`
   - `https://k8s.jeffistores.in` (hosts-file override) → Coroot; `/headlamp` → token from `kubectl -n observability create token headlamp-viewer`
   - `kubectl -n jeffi get cronjobs`, then `/api/admin/cron/status` shows runs
8. **Cutover:**
   1. Stop the old in-process cron first: the old box must not double-run jobs. Stop its app containers, or set `IN_PROCESS_CRON=false` in `jeffi/production` and restart.
   2. Switch the CloudFront origin to `ec2-32-196-38-130.compute-1.amazonaws.com`.
   3. Route53: point `*.jeffistores.in`, `*.business.jeffistores.in` (the `business` record stops the outer wildcard from covering Pro/Enterprise `{slug}.business` hosts), `admin`, `business`, `forms`, `quotation`, `invoice`, `purchaseorder`, `certificate`, `ecom`, `vault` and `k8s` at `32.196.38.130`. Delete the dangling per-tenant records (34.228.196.195 / 100.27.185.5).
   4. Watch Coroot for 5xx.
   5. **Stop (do not terminate)** `i-0b2466b2a540d6f23`. Keep it stopped for a week as the rollback path.
9. **CI:** add the repo secrets `KUBECONFIG_B64`, `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` (a tag:ci OAuth client), then set the repo variable `K8S_DEPLOY=true`. That switches `deploy`, schema and migrations to k3s and skips the EC2/SSM jobs.
10. **Razer monitoring:** install the Coroot node and cluster agents in the Razer k3s, pointing at Coroot's Tailscale address. Add the Razer kubeconfig to Headlamp.

## Needs IAM changes (blocked for the agent; do these by hand)

- `jeffi-stores-ec2-role`: add `s3:PutObject/GetObject/DeleteObject` on `jeffi-stores-bucket/*` and `jeffi-stores-vault/*`.
  Then remove the `AllowUploadFromApplication` (Principal `*` write) statement from the `jeffi-stores-bucket` policy. Today that bucket is publicly writable and deletable.
- `jeffi-stores-ec2-role`: `s3:PutObject/GetObject/ListBucket` on `jeffi-stores-mtls-truststore/k3s-etcd/*`. After that, add `--etcd-s3 --etcd-s3-bucket jeffi-stores-mtls-truststore --etcd-s3-folder k3s-etcd` to `core-node.sh` so etcd snapshots leave the box.
- Store servers (`jeffi-tenant-provisioning`, a managed policy attached to `jeffi-stores-ec2-role`): `aws iam create-policy-version --policy-arn arn:aws:iam::708835965056:policy/jeffi-tenant-provisioning --policy-document file://deploy/aws/tenant-provisioner-iam-policy.json --set-as-default` (at most 5 versions: delete the oldest non-default one first) (instances, database disks and snapshots, `jeffi/tenant-db/*`, `tenant-backups/*`). Then `bash deploy/k8s/bootstrap/service-secrets-iam.sh` (creates `jeffi-tenant-node-profile`), `K8S_TENANT_NODE_IAM_PROFILE: jeffi-tenant-node-profile` in the `provisioning` ConfigMap (`platform/43-provisioner-rbac.yaml`; restart the controller to pick it up) and `bash deploy/k8s/bootstrap/tenant-db-snapshots.sh`.
- Replace the root access keys used locally with a scoped IAM user (GitHub now assumes `jeffi-github-deploy` over OIDC; see Releasing).
- `jeffi-github-deploy`: re-run `bash deploy/k8s/bootstrap/github-oidc.sh` (`--dry-run` prints the policies first). Its `OwnSessions` statement named `session/${aws:userid}-*`, which never matches an assumed role's sessions (SSM names them `GitHubActions-<id>`), so every `ssm:TerminateSession` was denied and each stage left its tunnel open on the core for 20 minutes. About fifteen of those make the agent refuse new sessions (`Plugin with name Port not found`) and the release fails at its next tunnel. Until the role is updated the stages print a warning for each session they could not close.

## Releasing

Every release is the same three steps: the eight images (`jeffi-stores-{controller,storefront,admin,business,messaging,document,public-api,mobile}-service:local-<sha>`; the four Next apps from `deploy/next-app.Dockerfile` with `APP=<app>-service`), built from the committed `HEAD` (arm64, from `git archive`, so uncommitted and local files never ship) and pushed to ECR (tags already there are skipped); the databases; then the services. The tag is the last commit that changed the image contents (`lib.sh image_sha`), so a Mac and GitHub build of the same commit share images.

**Two schema sets.** The flagship database (`jeffi_stores`) gets the platform set: every `<service>/database/` plus each `platform-only/` folder, and the control-plane set. A store tenant's own database gets the tenant set: `<service>/database/` without `platform-only/` (`scripts/db-files.mjs tenant`, `database/README.md`). Provisioning, the tenant fan-out and the tenant migrations all use the tenant set; a migration under `platform-only/migrations/` runs on the flagship only.

**From GitHub (the normal path).** A push to `main` (a squash-merged PR) runs `.github/workflows/ci.yml`. The checks, the eight images (arm runners) and the release notes (the commits since the live commit, and whether a `database/` folder changed) start together; once they pass, `Checks passed` waits on the `production` environment. Approve it there; every stage after it runs in `production-release` (no reviewer, same branches) over an SSM tunnel, and a failure stops what depends on it:
1. **DB** (one card, two jobs side by side; each runs its schema step, then its migrations):
   - **DB · flagship**: `release-db.sh --flagship --schema` → `10-platform-schema.sh` (table ownership, the additive diff of the platform set, `manual.sql`), the control-plane diff and the plan seed, then `--migrations` (pending files, `schema_migrations`), all on `jeffi_stores`.
   - **DB · tenants**: `release-db.sh --tenants` → `40-tenant-fanout.sh`: a one-off Job (`tenant-db-<sha>-<half>`, `bootstrap/release-job.py`) from the release's controller image runs the tenant-set schema fan-out, then the tenant migrations, on every active store's database, before any service rolls. The Job runs the controller on its own port and calls `/api/internal/migrations/fanout` and `files-fanout` on it; its log is each store's result, and it is kept a day (`kubectl -n jeffi logs job/tenant-db-<sha>-schema`). `40-tenant-fanout.sh live --report` (`--slug=<slug>` for one store) changes nothing: each store database's tables beyond the tenant set, with row counts, and the tenant tables it lacks. The fan-out reads `tenants`, `tenant_infra` and `tenant_migration_runs` on the flagship while DB · flagship may be changing the control plane: a release that adds a column the fan-out itself reads must ship that column one release earlier.
2. **Deploy · prepare**: `store-secret.sh` (`jeffi/store` from `jeffi/production`), then `rollout.sh <tag> platform prep`: room on the core for the flagship's store pods, the ECR pull secret, and what the services share (namespaces, edge, Redis, RBAC, config, and the `release` ConfigMap new stores take their images from).
3. **Release · \<service>** (one card, a column of nine jobs side by side; each smoke-tests its own service with `smoke.sh <sha> <service> flagship|tenants`):
   - **controller**: once the flagship's storefront, admin and business run the release (the store paths leave the controller first), the platform routes (`platform/49-routes.yaml`, from `npx tsx deploy/k8s/gen-routes.ts`), the controller and the CronJobs (`rollout.sh <tag> platform controller`), then `rollout.sh <tag> stores shared`: every store's namespace re-applied without its service pods (routes, config, database), and a store still on the old all-in-one app moved onto its own services, one at a time (`switch-layout`; one that fails goes back to its old app and the job stops).
   - **storefront, admin, business, messaging, documents**: the flagship's deployment (`platform <service>`), its smoke test, then, once Release · controller is done (the release's controller re-applies the stores), every store's `{slug}-<service>-service` (`rollout.sh <tag> stores <service>`, through `POST /api/internal/provisioning/reconcile-k8s?part=<service>`): a store whose plan has no pod for it is skipped, and a store whose pods fail is rolled back and stops the job. Release · messaging ends with **Templates · catalog** (`deploy/k8s/db/50-seeds.sh`, in the new messaging pod: catalog templates the database lacks, email content brought up to the catalog, WhatsApp bodies moved to `{{brand_name}}`; idempotent).
   - **public-api, mobile**: their one platform deployment.
   - **ai-gateway**: `razer-release.sh` builds and rolls the gateway on the Razer box, then its smoke test; nothing waits for it (the box may be offline).
4. **CloudFront** (after every service, whatever their result), then **Post** (every stage's result in the summary). **Mobile · Android** sits beside the DB card when the merge touched `mobile-service/client`.
   The job only invalidates. The distribution (`E1M6ZFCWXAMF26`, jeffistores.in) is configured by hand: its default behavior must allow every method (GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE; cache GET/HEAD only) because page server actions, such as infinite lists loading more, POST to the page URL. With GET/HEAD/OPTIONS only, CloudFront answers those with a 403 (fixed 2026-11-13).

The release takes no database backup of its own: `jeffi_stores` and dedicated store databases rely on RDS automated backups (point-in-time restore); store databases on the store's own server on the daily `node_db_backup` S3 dumps and EBS snapshots (`bootstrap/tenant-db-snapshots.sh`). Before a risky schema change, take one by hand: `bash deploy/k8s/db/00-backup.sh`. The SQL applied lands in the run summary, and the logs in each DB job's `db-…` artifact. Run it from any branch with `gh workflow run ci.yml --ref <branch> -f deploy=true`: `dry_run` is on by default (images are built and pushed, DB · flagship prints the SQL it would apply, DB · tenants has the API server validate its Job, each service shows its `kubectl diff` and what it would apply in the stores, nothing in production changes); add `-f dry_run=false` for a real release.

- **One-time setup:** `bash deploy/k8s/bootstrap/github-oidc.sh` (`--dry-run` prints the policies). It creates `jeffi-github-build` (any branch: ECR push only) and `jeffi-github-deploy` (only the `production` and `production-release` environments: tunnels, database, CloudFront). Then `gh secret set AWS_BUILD_ROLE_ARN`, `gh secret set AWS_ROLE_ARN` (the deploy role) and `base64 < ~/.kube/jeffi-k3s.yaml | gh secret set KUBECONFIG_B64`; in GitHub → Settings → Environments: `production` with yourself as required reviewer, and `production-release` with no reviewer, both limited to `main` and `release/k8s-local`; branch protection on `main` requires `PR Gate`. The k3s admin cert in that kubeconfig lasts about a year: when the deploy job's `kubectl` starts failing, re-set `KUBECONFIG_B64` from the core.
- **Secrets no workflow reads any more** (delete them): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EC2_HOST`, `EC2_INSTANCE_ID`, `EC2_SSH_KEY`, `EC2_USER`, `GH_DEPLOY_TOKEN`, `RDS_MASTER_PASSWORD`, `DATABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `APP_URL`.

**Admin API secret.** `ADMIN_GATEWAY_SECRET` signs the header public-api-service attaches to `/v1/admin` and `/v1/platform` calls it forwards to a store. Before the first release that ships it, run `bash deploy/k8s/bootstrap/ensure-release-secrets.sh --cluster` (add `--dry-run` to look first): it generates `ADMIN_GATEWAY_SECRET` (and `CRON_SECRET`) in `jeffi/production` if missing, never replacing an existing value, copies the gateway secret to `jeffi/public-api/production`, and checks the k8s `cron-secret` the CronJobs read. Each release's `store-secret.sh` copies both to `jeffi/store`. Never put it in `jeffi/messaging/*` or `jeffi/documents/*`. Without it those routes answer 503 and the stores refuse the header; nothing else changes.

**From a Mac** (GitHub unavailable, or a hotfix), the same three steps from a clean, committed tree:
1. `bash deploy/k8s/bootstrap/release.sh --build-only`: the images, pushed to ECR (the tenant databases' Job runs the release's controller image, so it must be there before step 2).
2. `bash deploy/k8s/db/release-db.sh` (`--dry-run` first): the flagship, then every store's database (`--flagship` or `--tenants` for one of them, `--schema` or `--migrations` for one half).
3. `bash deploy/k8s/bootstrap/release.sh --rollout-only` (`deploy-local.sh` is an alias): `rollout.sh <tag>` (`platform prep`, every platform service, then `stores shared` and each store service in turn), `smoke.sh <sha>` (every service), then `50-seeds.sh`. One part on its own: `rollout.sh <tag> platform <service>` or `rollout.sh <tag> stores <service>`, then `smoke.sh <sha> <service>`.

Preconditions: Docker running, ≥15 GB free disk (Docker corrupts its disk when it runs out). From a network that cannot reach port 22 (a VPN with rotating exit IPs) the tunnel falls back to SSM (`brew install --cask session-manager-plugin`); `TUNNEL=ssm` skips the SSH attempt. Never build on the core node: the build needs ~4 GB RAM and starves production.

## Rollback

- **App:** `kubectl -n jeffi rollout undo deploy/jeffi-stores-<service>-service`, or `-n tenant-<slug> … deploy/<slug>-<service>-service`.
- **Cutover:** start `i-0b2466b2a540d6f23`, point the CloudFront origin and DNS back at `52.20.193.62`, and unset `K8S_DEPLOY`.
