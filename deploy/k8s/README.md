# k3s platform — runbook

Master plan: `docs/K8S_MIGRATION_PLAN.md`. This folder is everything needed to stand the cluster
up and cut production over to it.

| Path | What |
|---|---|
| `bootstrap/launch-core.sh` | One-time: security groups, RDS ingress, the core `r7g.medium`, as the account's EC2 limit is 1 vCPU (user-data `core-node.sh`), EIP `32.196.38.130` |
| `bootstrap/core-node.sh` | Core user-data: Tailscale + k3s server (embedded etcd, 6-hourly snapshots) |
| `bootstrap/secrets.sh` | Seeds cluster Secrets from Secrets Manager + local `certs/` (prints no values) |
| `bootstrap/apply-platform.sh` | Applies `platform/` in dependency order |
| `bootstrap/release.sh` | Builds the four service images from `HEAD`, pushes them to ECR, runs `rollout.sh`, smoke-tests |
| `bootstrap/rollout.sh` | Rollout: platform, tenant schema fan-out, then every store namespace one at a time |
| `db/` | Production DB release scripts (backup, schema, control-plane merge, secrets, fan-out, seeds); see `docs/GO_LIVE_RUNBOOK.md` |
| `platform/` | Traefik config, cert-manager + wildcard, mTLS edge, the controller/messaging/document/public-api services, Redis, CronJobs, Coroot + Headlamp |
| `gen-cronjobs.ts` | Regenerates `platform/cronjobs.yaml` from `packages/store-core/src/lib/shared/cron-jobs.ts` (a test fails on drift) |

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
- Replace the root access keys used locally with a scoped IAM user (GitHub now assumes `jeffi-github-deploy` over OIDC; see Releasing).

## Releasing

Every release is `deploy/k8s/bootstrap/release.sh`: it builds the committed `HEAD` (arm64, from `git archive`, so uncommitted and local files never ship) into eight images (`jeffi-stores-{controller,storefront,admin,business,messaging,document,public-api,mobile}-service:local-<sha>`; the four Next apps from `deploy/next-app.Dockerfile` with `APP=<app>-service`), pushes them to ECR (tags already there are skipped), rolls them out with `rollout.sh`, then smoke-tests that the live `/api/health` reports the new commit. The tag is the last commit that changed the image contents (`lib.sh image_sha`), so a Mac and GitHub build of the same commit share images. Schema changes are never applied by it: see `deploy/k8s/db/` and `docs/GO_LIVE_RUNBOOK.md`.

**From GitHub (the normal path).** A push to `main` (a squash-merged PR) runs `.github/workflows/ci.yml`. The checks, the eight images (arm runners) and `Release notes` (the commits since the live commit, and whether `database/` changed) start together; once the checks pass, `Approve release` waits on the `production` environment. The database stages run while the images are still building; the rollout waits for both, and CloudFront is invalidated beside the store stages. Approve it there; each stage after it is its own job in the graph (environment `production-release`: no reviewer, same branches), each over an SSM tunnel, stopping at the first failure:
1. **Database · schema** (when `database/` changed since the live commit, or forced): `deploy/k8s/db/release-db.sh --schema` → `10-platform-schema.sh` (table ownership, the additive diff of `database/*.sql`, `manual.sql`) and the control-plane diff with the plan seed, all on `jeffi_stores`.
2. **Database · migrations** (every deploy): pending `database/migrations` files (`release-db.sh --migrations`); a no-op when all are recorded in `schema_migrations`.
3. **Roll out · platform**: `rollout.sh <tag> platform`: the flagship's storefront, admin and business first, then the platform routes (`platform/49-routes.yaml`, from `npx tsx deploy/k8s/gen-routes.ts`) once those serve, then the controller, the other services and the CronJobs.
4. **Database · tenants**: `rollout.sh <tag> tenant-db`, the schema and migration files fanned out to every store's database.
5. **Roll out · stores**: `rollout.sh <tag> stores`: every store re-applied at the release images, then each still on the old all-in-one app moved onto its own services, one store at a time (`switch-layout`; a store that fails goes back to its old app and the stage stops).
6. **Verify**: CloudFront invalidation, then `smoke.sh` (the live commit and every host).
7. **Templates · catalog** (after the platform smoke test and the store schema): `deploy/k8s/db/50-seeds.sh`, run in the new messaging pod. It adds catalog templates the database lacks, brings email content up to the catalog (platform defaults, and store copies nobody edited), and moves WhatsApp bodies to `{{brand_name}}`. Idempotent; a dry run prints what it would change.

The SQL applied lands in the run summary, and the logs in the `release-logs` artifact. Run it from any branch with `gh workflow run ci.yml --ref <branch> -f deploy=true`: `dry_run` is on by default (images are built and pushed, every database step prints the SQL it would apply, the cluster and tenant fan-out are checked, nothing in production changes); add `-f dry_run=false` for a real release, and `-f schema=true` to run the schema step without a `database/` change (existing drift).

- **One-time setup:** `bash deploy/k8s/bootstrap/github-oidc.sh` (`--dry-run` prints the policies). It creates `jeffi-github-build` (any branch: ECR push only) and `jeffi-github-deploy` (only the `production` and `production-release` environments: tunnels, database, CloudFront). Then `gh secret set AWS_BUILD_ROLE_ARN`, `gh secret set AWS_ROLE_ARN` (the deploy role) and `base64 < ~/.kube/jeffi-k3s.yaml | gh secret set KUBECONFIG_B64`; in GitHub → Settings → Environments: `production` with yourself as required reviewer, and `production-release` with no reviewer, both limited to `main` and `release/k8s-local`; branch protection on `main` requires `PR Gate`. The k3s admin cert in that kubeconfig lasts about a year: when the deploy job's `kubectl` starts failing, re-set `KUBECONFIG_B64` from the core.
- **Secrets no workflow reads any more** (delete them): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EC2_HOST`, `EC2_INSTANCE_ID`, `EC2_SSH_KEY`, `EC2_USER`, `GH_DEPLOY_TOKEN`, `RDS_MASTER_PASSWORD`, `DATABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `APP_URL`.

**From a Mac** (GitHub unavailable, or a hotfix): commit, run `bash deploy/k8s/db/release-db.sh` (`--dry-run` first) when the database changed, then `bash deploy/k8s/bootstrap/release.sh` (`deploy-local.sh` is an alias), which ends with `50-seeds.sh`. `--build-only` stops after the push; `--rollout-only` skips the builds. Preconditions: a clean working tree, Docker running, ≥15 GB free disk (Docker corrupts its disk when it runs out). From a network that cannot reach port 22 (a VPN with rotating exit IPs) the tunnel falls back to SSM (`brew install --cask session-manager-plugin`); `TUNNEL=ssm` skips the SSH attempt. Never build on the core node: the build needs ~4 GB RAM and starves production.

## Rollback

- **App:** `kubectl -n jeffi rollout undo deploy/jeffi-stores-<service>-service`, or `-n tenant-<slug> … deploy/<slug>-<service>-service`.
- **Cutover:** start `i-0b2466b2a540d6f23`, point the CloudFront origin and DNS back at `52.20.193.62`, and unset `K8S_DEPLOY`.
