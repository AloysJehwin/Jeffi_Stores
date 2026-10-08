# Kubernetes migration: master plan

_Last updated: 2026-10-08. Future move to upstream Kubernetes (kubeadm): [`K8S_KUBEADM_MIGRATION.md`](K8S_KUBEADM_MIGRATION.md)._

_ Implementation: branch `feat/k8s-readiness`; bring-up runbook: [`deploy/k8s/README.md`](../deploy/k8s/README.md)._


## Context
Production runs as Docker Compose on one EC2 (t4g.small `i-0b2466b2a540d6f23`, EIP 52.20.193.62). It uses blue/green containers, a hand-written nginx, crons that run inside the app process, and an SSH/SSM deploy. Today's tenant model has known bugs:
- Pool and dedicated EC2s are built from an AMI.
- `reprovisionDns` launches instances without user-data.
- The instance ID goes stale after a downgrade.
- Tenant buckets allow public PutObject.
- Per-host DNS records still point at IPs we no longer own.

There is no view of what is running or how each endpoint behaves.

**Goal: run everything on a self-managed k3s cluster on EC2.**
- Every tenant gets its own pods, sized by plan.
- The flagship store is just another workload.
- A Dynatrace-style view of every pod, ingress and endpoint is available at `k8s.jeffistores.in`. It is public, but needs a client certificate.

**Decisions so far**

| Topic | Decision |
|---|---|
| Core node | t4g.large |
| Tenant placement | Option A: Basic tenants get their own pod on a shared tenant EC2. Growth and above get their own EC2. |
| Observability | Coroot + Headlamp, running on EC2 |
| AI platform | Stays on the Razer. Only its **monitoring** moves to EC2: the Razer's AI pods appear in the same Coroot and Headlamp. |
| ALB | Already deleted |

This supersedes `docs/KUBERNETES_PLAN.md` (Basic tenants on shared pods, Razer as the observability node) and the draft `docs/K8S_MIGRATION_PLAN.md` on the local branch `docs/k8s-migration-plan`. Both are rewritten to match this plan in Phase 1.

## Pods and EC2, in plain terms
- **EC2 node**: a server we pay for by the hour. **Pod**: one running copy of the app inside a node, with hard CPU and RAM caps.
- A tenant's traffic follows this path:
  1. DNS `*.jeffistores.in` points at the core node.
  2. Traefik reads the host name, for example `acme.jeffistores.in`.
  3. It forwards the request to that tenant's Service.
  4. The Service sends it to that tenant's pod(s), on whichever node they run.
- A tenant never shares a pod, Redis or database with another tenant. The only thing Basic tenants share is the physical server.

| Node | Type | What runs on it |
|---|---|---|
| **core** | t4g.large (2 vCPU / 8 GB), EIP | k3s control plane, Traefik, cert-manager, Coroot, Headlamp, flagship store (2 pods), platform CronJobs |
| **pool-basic-N** | t4g.medium (4 GB) | Up to about 6 Basic tenants. A node is added when the current one is full. |
| **t-{slug}** | Sized by tier (below) | One Growth, Pro or Enterprise tenant only. The node is labelled and tainted to that tenant. |
| **razer** (separate k3s, unchanged) | Home GPU box | AI gateway and Ollama. Monitored from EC2 over Tailscale. |

**Per-plan tiers** (a code table, `src/lib/provisioning/tiers.ts`, so no schema change):

| Plan | Node | Replicas | Pod request / limit | Autoscaling (HPA) |
|---|---|---|---|---|
| basic | shared pool-basic | 1 | 200m, 384Mi / 1 CPU, 640Mi | no |
| growth | own t4g.small | 2 | 200m, 384Mi / 1 CPU, 640Mi | no |
| pro | own t4g.medium | 2 | 300m, 512Mi / 1.5 CPU, 900Mi | 2→3 |
| enterprise | own t4g.large | 2 | 500m, 768Mi / 2 CPU, 1.2Gi | 2→5 |
| flagship | core | 2 | 300m, 512Mi / 1.5 CPU, 900Mi | — |

- Every tenant pod runs with `WEB_CONCURRENCY=1`, so there is no Node cluster fork.
- Each tenant namespace also gets:
  - its own Redis pod (`redis:7-alpine`, 32Mi request, with a password);
  - a ResourceQuota and a PodDisruptionBudget;
  - a NetworkPolicy that allows ingress only from Traefik and Coroot. The policy controller is built into k3s.

## Architecture details

### Ingress, DNS, TLS
- **Traefik** is k3s's bundled ingress, configured through `HelmChartConfig`, running with hostNetwork on core ports 80/443. It is chosen over ingress-nginx because the ingress-nginx project was retired in March 2026, and this edge faces the internet.
- **DNS**:
  - A single wildcard `*.jeffistores.in` A record points at the core EIP. It replaces the per-host upserts in `tenant-dns.ts`, which is kept only for custom domains.
  - The apex and `www` stay on CloudFront (`E1M6ZFCWXAMF26`), with the origin switched to the core EIP.
  - Delete the dangling records that point at 34.228.196.195 and 100.27.185.5.
- **Certificates**:
  - cert-manager uses DNS-01 against Route53 (zone `Z08094881XKVZ9XSGBKG1`) to issue a wildcard `*.jeffistores.in` plus the apex.
  - Custom domains get a per-host HTTP-01 Certificate created by the provisioning engine. This implements the cert attach that is missing today (`cert_arn` is never set).
- **Hostnames per tenant**: generated from `tenantHostnames()` in `src/lib/provisioning/steps.ts`. That covers the storefront, `admin-{slug}`, `vault-{slug}` and the rest, plus the custom domains in `custom_domains`. All of them route to the tenant's Service.

### mTLS mapping
Today nginx handles client certificates. Traefik takes over as follows:

| Host | Traefik setting | Header the app reads |
|---|---|---|
| `admin.jeffistores.in`, `k8s.jeffistores.in` | `TLSOption` set to `RequireAndVerifyClientCert`, CA = platform CA Secret | Serial and CN |
| `admin-{slug}` | `TLSOption` set to `RequestClientCert` (same as today's `optional_no_ca`), CA list = `client-ca-bundle` Secret | Full certificate; the app verifies it per tenant in `tenant-mtls.ts` |

- **Passing the certificate on**: the `passTLSClientCert` middleware sends the certificate (PEM) and its info (serial, subject CN).
- **App change**: `src/middleware.ts` reads Traefik's `X-Forwarded-Tls-Client-Cert` and `-Info` headers, maps them to the existing internal `x-client-cert`, `-serial` and `-cn`, and keeps stripping any client-supplied headers of those names.
  - A Traefik `headers` middleware also blanks the incoming header names on every route, so a forged header cannot reach the app.
- **CA bundle updates**: `src/lib/tenancy/mtls-fleet.ts` stops pushing through S3 and SSM. It patches the `client-ca-bundle` Secret instead, and Traefik reloads it live.
- **Who gets the CA**: the platform CA key is mounted only into flagship pods, never into tenant pods.

### Observability at `k8s.jeffistores.in` (client certificate required)
- **Coroot** (Community edition), at `/` on the core node, with Prometheus and ClickHouse and 7-day retention.
  - It provides an eBPF service map, per-endpoint latency and errors (the "Lighthouse per endpoint" view), container logs, and node and pod resources. No app code changes are needed.
  - Its node agent runs as a DaemonSet on every EC2 node.
- **Headlamp** at `/headlamp`: pods, Ingresses/IngressRoutes, events and logs, with a read-only ServiceAccount by default.
- **Razer**:
  - Install the Coroot node and cluster agents in the Razer k3s, pushing to Coroot over Tailscale. The core node joins the tailnet.
  - Add the Razer cluster as a second kubeconfig in Headlamp.
  - Result: one UI on EC2 shows both clusters, while the AI workloads stay on the Razer.
- **Memory**: Coroot plus ClickHouse is the heaviest component, at about 2.5 GB. If core memory pressure exceeds 85%, the fallback is core → t4g.xlarge (+$49/month).

### Crons → Kubernetes CronJobs
- **New gate**: `IN_PROCESS_CRON=false` in `src/instrumentation.ts` turns off the `setInterval` scheduler in pods.
- **Generated CronJobs**: generate the CronJobs from the `CRON_JOBS` registry in `src/lib/shared/cron-jobs.ts` (script → Helm values).
  - Each one is a curl to the in-cluster flagship Service with `Authorization: Bearer $CRON_SECRET` and `concurrencyPolicy: Forbid`.
  - 45-second jobs become every 1 minute.
  - The 24-hour jobs (`daily_briefing`, `customer_notes_digest`) run at fixed IST times instead of on every restart.
- **Recording runs**: keep the `cron-record` call, so the admin cron status page still works.
- **Nightly merchant syncs**: add the two syncs currently installed by `deploy/sync-cron-setup.sh`.
- **Retire** the EventBridge stop/start in `deploy/scheduler-setup.sh`. It is incompatible with an always-on SaaS.

### App runtime changes (small, ship first)
- **`cluster-server.js`**: when `WEB_CONCURRENCY=1`, run `server.js` directly. Handle SIGTERM by not re-forking and closing gracefully.
  - Pods get `preStop: sleep 10` and `terminationGracePeriodSeconds: 60`.
- **Probes**: liveness `/api/health`, readiness `/api/ready`, plus a startupProbe.
- **Secrets**: keep `deploy/load-secrets.mjs`, which reads Secrets Manager through the node instance profile. Set IMDSv2 hop limit to 2 on all nodes.
- **Mounted files**:
  - The RDS `global-bundle.pem` comes from a ConfigMap.
  - The Google service-account JSON comes from the env var `GOOGLE_SERVICE_ACCOUNT_JSON`.
  - The platform CA comes from a Secret mounted at `/app/certs`.
  - A writable emptyDir is mounted for openssl's `.srl` file and `/tmp`.
- **Egress to the AI gateway**: pods reach `AI_GATEWAY_URL` (100.82.208.8) through the node's Tailscale. Every node runs tailscaled, installed by user-data.
- **Accepted limits, logged for later**:
  - The Next ISR cache is per pod, so revalidation does not cross replicas.
  - The rate limiter is in-memory per pod.

### Provisioning engine → k8s provider
New file `src/lib/provisioning/k8s-provider.ts` behind the existing seam (`ensureAppInstance` / `deleteAppInstance` / `isInstanceGone` in `provider.ts`), selected with `PROVISIONING_PROVIDER=k8s`. It talks to the API server through a small fetch wrapper using its ServiceAccount token. RBAC is limited to `tenant-*` namespaces, Nodes and Certificates.

- **`ensure_compute`**:
  - Ensures the namespace, Deployment (tier resources plus `nodeSelector`/toleration), Service, Redis, IngressRoutes for every tenant host, and Certificate(s) for custom domains.
  - For Growth and above, it first launches the tenant's EC2 through the existing `ec2-client.ts`. User-data contains the k3s agent join (token from Secrets Manager), tailscale, and the node label and taint.
  - For Basic, it picks a pool node with room, or launches a new one. This replaces `pool-autoscale.ts`.
- **`configure_dns`**: a no-op for platform hosts (the wildcard covers them). It only checks the customer's CNAME for custom domains.
- **`change-plan`**: patches the Deployment's resources and placement, launches or drains nodes, and drains the old node. This replaces the buggy `reprovisionDns` EC2 path.
- **Deprovision**: deletes the namespace, then deletes the dedicated node and its EC2.
  - `clearTenantInfra` also clears `ec2_target` and `s3_bucket`, which today it leaves behind.
- **Rollouts**: the desired image tag lives in a ConfigMap `platform/release`. Newly provisioned tenants read it.
- **Other infrastructure**:
  - RDS security-group ingress is opened from the node security group, so per-tenant IAM DB auth keeps working.
  - Fix the tenant S3 bucket policy: no public Put/Delete; writes go through IAM.

### CI/CD (`.github/workflows/ci.yml`)
- **`docker` job**: keep the arm64 build, plus an **immutable** `main-<sha>` tag. Deploys use only that tag, never `:latest`.
- **New `deploy` job**:
  1. Join the tailnet with `tailscale/github-action` (OAuth client).
  2. Using a kubeconfig secret, run `helm upgrade platform` for the flagship, CronJobs and Traefik config.
  3. Update `platform/release`.
  4. Roll tenants one namespace at a time: `kubectl set image` + `rollout status`, stopping on the first failure. `kubectl rollout undo` is the rollback.
- **Schema**: `schema-diff` and `migrate` become Kubernetes Jobs. A small `schema-tools` image holds migra and postgres, runs `deploy/schema-diff.sh` unchanged, and then calls the fan-out endpoint in-cluster.
- **Unchanged**: `invalidate-cdn` and `smoke-test`.
- **Removed**: the SSH deploy, `fleet-config`, `deploy-fleet` (SSM on `tag:app=jeffi-tenant`), the blue/green scripts, the nginx configs and `fleet-apply.sh`, all after cutover.
- **Manifests**: a Helm chart under `deploy/k8s/` holds `platform/` (flagship, CronJobs, Traefik, cert-manager issuers, Coroot, Headlamp) and `tenant/`, a template the provider renders in code. Tenant objects are created by the engine, not committed to git.

### Admin UI
The ecom tenant detail "Instances/Infrastructure" tabs show the Kubernetes data:
- namespace, pods, ready replicas, node and tier;
- restart and CPU/RAM figures from the API server;
- deep links into Headlamp and Coroot.

The EC2-specific panels are removed.

## Monthly AWS cost (us-east-1 on-demand, USD)

| Item | Detail | $/month |
|---|---|---|
| Core node | t4g.large, 730 h × $0.0672 | 49.06 |
| Core EBS | 40 GB gp3 | 3.20 |
| Public IPv4 | Core EIP | 3.65 |
| RDS platform | db.t4g.small + 20 GB gp2 (+ backups within the free allowance) | 25.66 |
| CloudFront | Current traffic | ~2 |
| Route53 | 1 zone + queries | ~1 |
| Secrets Manager | ~4 secrets × $0.40 + API calls | ~2 |
| S3 | Assets, vault, mTLS, etcd snapshots | ~2 |
| Data transfer out + EBS snapshots + CloudWatch | | ~4 |
| **Platform baseline (0 tenants)** | | **≈ $93** |
| **+ 18% GST** | | **≈ $110 / month** |

That is about $6/month more than today's run-rate (about $88 pre-tax). It includes Coroot and Headlamp. The ALB is already deleted. Releasing the 4 idle EIPs and the 9 loose volumes saves about $15 more.

**Per tenant, added on top** (pre-GST; revenue for comparison):

| Plan (₹/month) | Compute | Tenant RDS (db.t4g.micro + 20 GB) | Total |
|---|---|---|---|
| Basic (₹4,999 ≈ $57) | Share of pool-basic: t4g.medium $24.5 + EBS $1.6 + IPv4 $3.65 ≈ $30 ÷ 6 ≈ $5 | $14 | **≈ $19–20**. The first Basic tenant brings up the pool node, ≈ $44. |
| Growth (₹9,999 ≈ $115) | t4g.small $12.3 + EBS $1.6 + IPv4 $3.65 | $14 | **≈ $32** |
| Pro (₹19,999 ≈ $230) | t4g.medium $24.5 + EBS $1.6 + IPv4 $3.65 | $14 | **≈ $44** |
| Enterprise (₹49,999 ≈ $575) | t4g.large $49 + EBS $3.2 + IPv4 $3.65 | $14 (or db.t4g.small, $26) | **≈ $70–82** |

Optional: a 1-year Compute Savings Plan cuts EC2 by about 30% once the fleet is stable.

## Phases
0. **Cleanup and security** (each AWS action needs the user's explicit approval):
   - Release the idle EIPs, delete the loose volumes, delete the dangling tenant DNS.
   - Fix the tenant S3 public-write policy.
   - Replace the root access keys with an IAM user/role.
   - Rotate the Razer Postgres passwords in `.claude/settings.local.json`.
   - Remove `rzp-key.csv` and `certs/*.p12` from the working tree.
1. **App readiness** (code only; harmless on the current EC2):
   - The `IN_PROCESS_CRON` gate.
   - Graceful shutdown with the single-process path.
   - The Traefik client-certificate header adapter in middleware, with tests.
   - Configurable cert and file paths; `mtls-fleet` Secret mode behind the provider flag.
   - `tiers.ts`.
   - Rewrite `docs/K8S_MIGRATION_PLAN.md` and update `docs/SAAS_MULTITENANT_STATUS.md`.
2. **Cluster bring-up**:
   - Launch the core t4g.large with k3s server (etcd snapshots to S3) and Tailscale.
   - Install Traefik config, cert-manager plus the wildcard, Coroot and Headlamp at `k8s.jeffistores.in` with mTLS.
   - Install the Coroot agents on the Razer.
3. **Flagship cutover**:
   - Deploy the platform release (flagship ×2, Redis, CronJobs) and test via `k8s-test.jeffistores.in` and a hosts-file override.
   - Then switch the CloudFront origin and the wildcard/`admin`/`business`/`forms`/… records to the core EIP.
   - Keep the old EC2 **stopped**, not terminated, for one week as a rollback.
4. **CI/CD**: Tailscale-based deploy, schema Jobs, tenant rollouts. Delete the SSH/SSM jobs.
5. **Tenants on k8s**:
   - Add the k8s provider and the pool-basic and dedicated node bootstrap.
   - Run `change-plan` and deprovision.
   - Run a full test-tenant lifecycle: provision Basic → upgrade to Growth → custom domain → downgrade → deprovision.
6. **Admin UI and retirement**: k8s infrastructure tabs. Delete the AMI, `user-data.ts` EC2 compose path, `pool-autoscale`, the fleet scripts, nginx and blue/green files.
7. **Hardening**:
   - Per-tenant Secret subsets instead of the full `jeffi/production`.
   - Pod-level IAM (self-hosted OIDC + pod identity webhook).
   - Default-deny NetworkPolicy audit.
   - Coroot alert rules to email or WhatsApp.

## Risks
- **Single control-plane node**: it is a single point of failure, the same as today. Mitigated by k3s etcd snapshots to S3 and a documented restore runbook.
- **Core RAM**: Coroot and ClickHouse make 8 GB tight. Watch in Phase 2; the fallback is t4g.xlarge.
- **Shared node IAM**: Basic tenants on the same pool node share its instance profile. Scope it to `rds-db:connect` and S3 for those tenants until Phase 7.
- **Traefik mTLS header semantics**: verify forged-header stripping and serial format before cutover.
- **Pods → Razer over Tailscale (SNAT)**: verify in Phase 2.
- **ISR/cache per pod**: content can be up to about 120 s stale across replicas.

## Verification
- **Phase 1**:
  - `node_modules/.bin/tsc --noEmit`, the full `npx vitest run`, and new tests for the header adapter, the cron gate and `tiers.ts`.
  - Local run with `IN_PROCESS_CRON=false`, confirming that no jobs fire (with the mail, SMS and WhatsApp kill switches on).
  - `graphify update .`
- **Phase 2**:
  - `kubectl get nodes,pods -A` is healthy.
  - `curl` to `k8s.jeffistores.in` **without** a certificate returns a TLS/403 failure; **with** the platform client certificate, Coroot and Headlamp load, and the Razer cluster is visible.
  - The wildcard certificate is issued.
- **Phase 3**:
  - Smoke-test the storefront, checkout (Razorpay test mode), `admin.` mTLS login, an `admin-{slug}` tenant certificate, vault streaming, SSE admin events, and image upload.
  - Coroot shows per-endpoint latency for `/api/*`.
  - The CronJobs record runs in `/api/admin/cron/status`.
  - The CI smoke test passes through CloudFront.
- **Phase 5**:
  - In a full test-tenant lifecycle, the pods land on the right node per tier.
  - A cross-tenant NetworkPolicy check shows that a pod in tenant A cannot reach tenant B's Service or Redis.
  - Deprovisioning leaves no namespace, node, EC2 or DNS record behind.
- **Cost**: Cost Explorer at day 30 should land within ±10% of the table.
