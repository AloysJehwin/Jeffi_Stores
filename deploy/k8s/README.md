# k3s platform — runbook

Master plan: `docs/K8S_MIGRATION_PLAN.md`. This folder is everything needed to stand the cluster
up and cut production over to it.

| Path | What |
|---|---|
| `bootstrap/launch-core.sh` | One-time: security groups, RDS ingress, the core `t4g.large` (user-data `core-node.sh`), EIP `32.196.38.130` |
| `bootstrap/core-node.sh` | Core user-data: Tailscale + k3s server (embedded etcd, 6-hourly snapshots) |
| `bootstrap/secrets.sh` | Seeds cluster Secrets from Secrets Manager + local `certs/` (prints no values) |
| `bootstrap/apply-platform.sh` | Applies `platform/` in dependency order |
| `bootstrap/rollout.sh` | CI rollout: platform, then every tenant namespace one at a time |
| `platform/` | Traefik config, cert-manager + wildcard, mTLS edge, flagship, Redis, CronJobs, Coroot + Headlamp |
| `gen-cronjobs.ts` | Regenerates `platform/cronjobs.yaml` from `src/lib/shared/cron-jobs.ts` (a test fails on drift) |

Tenant namespaces are **not** in git. The provisioning engine renders them
(`src/lib/k8s/tenant-workload.ts`) and applies them (`src/lib/k8s/tenant-compute.ts`) when
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
6. **Apply:** `bash deploy/k8s/bootstrap/apply-platform.sh main-<sha>`
7. **Verify before any DNS change**, with `curl --resolve`:
   - `curl --resolve jeffistores.in:443:32.196.38.130 https://jeffistores.in/api/ready`
   - `curl --resolve admin.jeffistores.in:443:32.196.38.130 https://admin.jeffistores.in/` → TLS handshake failure without a cert; works with `--cert certs/client-cert.pem --key certs/client-key.pem`
   - `https://k8s.jeffistores.in` (hosts-file override) → Coroot; `/headlamp` → token from `kubectl -n observability create token headlamp-viewer`
   - `kubectl -n jeffi get cronjobs`, then `/api/admin/cron/status` shows runs
8. **Cutover:**
   1. Stop the old in-process cron first: the old box must not double-run jobs. Stop its app containers, or set `IN_PROCESS_CRON=false` in `jeffi/production` and restart.
   2. Switch the CloudFront origin to `ec2-32-196-38-130.compute-1.amazonaws.com`.
   3. Route53: point `*.jeffistores.in`, `admin`, `business`, `forms`, `quotation`, `invoice`, `purchaseorder`, `certificate`, `ecom`, `vault` and `k8s` at `32.196.38.130`. Delete the dangling per-tenant records (34.228.196.195 / 100.27.185.5).
   4. Watch Coroot for 5xx.
   5. **Stop (do not terminate)** `i-0b2466b2a540d6f23`. Keep it stopped for a week as the rollback path.
9. **CI:** add the repo secrets `KUBECONFIG_B64`, `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` (a tag:ci OAuth client), then set the repo variable `K8S_DEPLOY=true`. That switches `deploy`, schema and migrations to k3s and skips the EC2/SSM jobs.
10. **Razer monitoring:** install the Coroot node and cluster agents in the Razer k3s, pointing at Coroot's Tailscale address. Add the Razer kubeconfig to Headlamp.

## Needs IAM changes (blocked for the agent; do these by hand)

- `jeffi-stores-ec2-role`: add `s3:PutObject/GetObject/DeleteObject` on `jeffi-stores-bucket/*` and `jeffi-stores-vault/*`.
  Then remove the `AllowUploadFromApplication` (Principal `*` write) statement from the `jeffi-stores-bucket` policy. Today that bucket is publicly writable and deletable.
- `jeffi-stores-ec2-role`: `s3:PutObject/GetObject/ListBucket` on `jeffi-stores-mtls-truststore/k3s-etcd/*`. After that, add `--etcd-s3 --etcd-s3-bucket jeffi-stores-mtls-truststore --etcd-s3-folder k3s-etcd` to `core-node.sh` so etcd snapshots leave the box.
- Replace the root access keys used locally and in GitHub `AWS_ACCESS_KEY_ID` with a scoped IAM user.

## Rollback

- **App:** `kubectl -n jeffi rollout undo deploy/flagship`, or `-n tenant-<slug> … storefront`.
- **Cutover:** start `i-0b2466b2a540d6f23`, point the CloudFront origin and DNS back at `52.20.193.62`, and unset `K8S_DEPLOY`.
