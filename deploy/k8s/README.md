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
| `gen-cronjobs.ts` | Regenerates `platform/cronjobs.yaml` from `controller-service/src/lib/shared/cron-jobs.ts` (a test fails on drift) |

Tenant namespaces are **not** in git. The provisioning engine renders them
(`controller-service/src/lib/k8s/tenant-workload.ts`) and applies them (`controller-service/src/lib/k8s/tenant-compute.ts`) when
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
- Replace the root access keys used locally and in GitHub `AWS_ACCESS_KEY_ID` with a scoped IAM user.

## Deploying without CI (GitHub unavailable)

Commit your changes, then run `bash deploy/k8s/bootstrap/release.sh` (`deploy-local.sh` is an alias).

It builds the committed `HEAD` on this Mac (arm64, from `git archive`, so uncommitted and local files never ship) into four images (`jeffi-stores-{controller,messaging,document,public-api}-service:local-<sha>`), pushes them to ECR, rolls them out with `rollout.sh`, then smoke-tests that the live `/api/health` reports the new commit. `--build-only` stops after the push. Schema changes are not applied by it: see `deploy/k8s/db/` and `docs/GO_LIVE_RUNBOOK.md`.

- **Preconditions:** a clean working tree, Docker Desktop running, and ≥15 GB free disk (Docker corrupts its disk when it runs out).
- **Rollback:** `kubectl -n jeffi rollout undo deploy/jeffi-stores-controller-service` (likewise the other three services).
- **Never build on the core node:** the build needs ~4 GB RAM and starves production.

## Rollback

- **App:** `kubectl -n jeffi rollout undo deploy/jeffi-stores-<service>-service`, or `-n tenant-<slug> … deploy/<slug>-<service>-service`.
- **Cutover:** start `i-0b2466b2a540d6f23`, point the CloudFront origin and DNS back at `52.20.193.62`, and unset `K8S_DEPLOY`.
