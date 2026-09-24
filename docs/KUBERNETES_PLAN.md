# Self-Managed Kubernetes Plan

_Last updated: 2026-09-24_

> **Status: plan only. Nothing here is provisioned or implemented.** This document records the
> agreed direction for moving the application onto a Kubernetes cluster that we run ourselves
> (k3s on our own EC2 nodes), with a dashboard for ingress and egress traffic. A managed control
> plane (EKS) is explicitly out of scope. `docs/SAAS_MULTITENANT_STATUS.md` remains the
> authoritative description of the tenant provisioning engine that this plan has to carry over.

---

## 1. What runs today (verified against the repo, 2026-09-24)

| Layer | Current implementation |
|---|---|
| Compute | One flagship EC2 (Graviton, `t4g.small`, us-east-1) with an Elastic IP. Docker Compose on the box: nginx (TLS + admin mTLS), Redis, and the Next.js app in blue and green slots. |
| Deploy | CI builds a `linux/arm64` image to GHCR, SSHes into the box and runs `deploy/blue-green-deploy.sh` (pull, start idle slot, probe `/api/health`, swap nginx upstream, stop old slot). The same script is fanned out to tenant instances over SSM. |
| Edge | CloudFront in front of the storefront with an HTTP origin on the EIP. `admin.`, `business.` and tenant hosts resolve straight to the EIP; nginx does mTLS (`ssl_verify_client on` for the platform admin, `optional_no_ca` for tenant admin hosts with the app verifying against the tenant CA). |
| Data | RDS Postgres 16 (`jeffi-stores-db`, `db.t4g.small`) holds the platform DB and `jeffi_control_plane`. The provisioning engine creates a private `db.t4g.micro` per tenant, an S3 bucket per tenant and explicit Route53 records per tenant host. |
| Secrets | Loaded at container boot from Secrets Manager `jeffi/production` through the instance profile. Platform CA, RDS bundle and the Google service account live on local disk under `certs/`. |
| Tenant compute | Basic plans share one pool EC2 that scales vertically by instance type (`pool-autoscale.ts`). Growth and above get a dedicated EC2 launched from a flagship AMI (`ensure_compute`). The client-CA bundle reaches the fleet through S3 plus SSM shell commands (`mtls-fleet.ts`). |
| Scheduling | In-process cron (`src/instrumentation.ts`) with Redis locks. An EventBridge schedule still stops the flagship EC2 and RDS nightly. |
| Observability | `/api/health` (liveness) and `/api/ready` (DB + Redis). No metrics, logs or traffic visibility. |

Gaps the cluster must fix rather than inherit:

- Redis is per box, so cron locks, rate limits and session events do not span instances.
- Certificate and CA key material sit on local disk and are pushed around with SSM.
- Every dedicated tenant is another EC2 to patch and deploy to.
- The nightly stop schedule contradicts always-on SaaS tenants.

## 2. Target architecture

**Cluster.** k3s on Graviton EC2 nodes in the existing VPC. Start with a **single node** that runs
the control plane and all workloads; add agent (worker) nodes with one join command when
traffic or the number of dedicated tenants needs it; move to three server nodes with embedded
etcd when control-plane HA is wanted. Cilium replaces flannel as the CNI so egress flows are
observable. AWS cloud controller manager and the EBS CSI driver provide load balancers and
volumes. Every add-on below runs inside the cluster; AWS stays only where it already is (EC2 for
nodes, RDS, S3, Route53, optionally an NLB).

**Ingress.** ingress-nginx. Either an NLB with static Elastic IPs and TLS passthrough, or the
Elastic IP attached directly to the ingress node. mTLS stays in nginx exactly as today:

- one Ingress for the flagship hosts with `auth-tls-verify-client: on` for `admin.jeffistores.in`;
- one wildcard Ingress (`*.jeffistores.in`) for tenant hosts with `optional_no_ca` and
  `auth-tls-pass-certificate-to-upstream`, the app keeps verifying against the tenant CA;
- cert-manager issues the wildcard certificate through Route53 DNS-01 and replaces certbot;
- the advertised client-CA bundle becomes a Kubernetes Secret written by the existing bundle
  rebuild, replacing the S3 plus SSM distribution.

The ingress IP becomes `TENANT_APP_TARGET_IP`, so `tenantHostnames` and `configure_dns` are
unchanged.

**Workloads.**

- `jeffi-app` Deployment for the flagship and the Basic pool: two or more replicas, rolling update
  with `maxUnavailable: 0` gated on `/api/ready`, an HPA and a PodDisruptionBudget. This gives
  zero-downtime deploys on a single node. Argo Rollouts is the option if an explicit blue-green
  preview slot must be preserved.
- Dedicated tenants (Growth and above) become their own Deployment, Service and Ingress, created
  by a Kubernetes implementation of `ensureAppInstance` in the provisioning engine instead of EC2
  launches; deprovisioning deletes the objects. A tainted node pool isolates them once there is
  more than one node.
- One Redis in the cluster on an EBS volume. Locks, rate limits and session events become
  cluster-wide.
- Postgres stays on RDS; the node security group is allowed on 5432. RDS Proxy remains a later
  option.
- External Secrets Operator syncs `jeffi/production` into a Secret consumed as env. Platform CA,
  RDS bundle and the Google service account are Secrets mounted at the paths the code reads.
- Cron: keep the in-process scheduler at first (locks are now global); migrate the registry in
  `src/lib/cron-jobs.ts` to CronJobs later.

**Egress.** Nodes in private subnets behind one NAT gateway give a fixed outbound IP for Razorpay,
Delhivery, Google and Amazon. Public nodes are the cheaper alternative with a changing outbound IP.

## 3. Ingress and egress dashboard

| Concern | Tooling | What you see |
|---|---|---|
| Ingress | kube-prometheus-stack + ingress-nginx metrics | Requests, status codes and latency per host. Every tenant is a host, so this is a per-tenant traffic view. |
| Egress | Cilium Hubble UI + Hubble metrics in Grafana | Every flow from app pods to external destinations by FQDN, DNS lookups, drops, L7 HTTP status. Network policies start in audit mode, then enforce an allowlist for partner APIs, RDS and S3. |
| Cluster | Headlamp (or the official Kubernetes Dashboard) | Pods, deployments, restarts, resource usage. |
| Logs | Loki + Promtail | nginx access logs by host, app logs by pod. |

All of it is published at an ops hostname behind the platform admin mTLS ingress, never public.

## 4. Migration order

1. **App changes** (about two days): accept the ingress-nginx client-cert header alongside
   `X-Client-Cert`; make Redis mandatory in production and Redis-backed for rate limits; point
   `TENANT_APP_TARGET_IP` at the ingress IP; retire the nightly stop schedule for production.
2. **Bootstrap** (about one day): node, k3s with Cilium, cloud controller manager, EBS CSI,
   cert-manager, ingress-nginx, External Secrets, Redis, kube-prometheus-stack, Hubble, Loki,
   Headlamp. All of it scripted under a `k8s/` directory (bootstrap script, Helm values, manifests).
3. **Shadow run**: the app on the cluster, smoke-tested per host type (storefront, admin mTLS,
   tenant storefront and admin, business, certificate portal, forms).
4. **Cutover** (hours): CloudFront origin and DNS to the ingress IP; keep the old EC2 warm for 48
   hours; then decommission the blue-green box, the SSM fan-out and pool autoscale.
5. **Provisioning on Kubernetes** (two to three days): `ensure_compute` creates cluster objects for
   dedicated tenants.
6. **Hardening**: alerts (5xx rate, latency, restarts, RDS connections), per-tenant dashboards,
   enforced egress policies, then additional nodes and HA as growth requires.

## 5. Estimated cost

us-east-1 on-demand list prices for Graviton (t4g), 24/7, USD per month, before tax. Verify in
the AWS pricing calculator before committing.

**Single node (recommended start)**

| Item | USD |
|---|---|
| 1 × t4g.large (2 vCPU, 8 GB) | 49 |
| 40 GB gp3 | 3.2 |
| Elastic IP | 3.7 |
| Snapshots | 2 |
| **Total** | **about 58** |

A t4g.medium (about 33) runs the app and ingress but is tight once Prometheus, Loki and Hubble are
added.

**Multi-node options**

| Item | A. Launch | B. Recommended | C. HA |
|---|---|---|---|
| Server nodes | 1 × t4g.medium, 24.5 | 1 × t4g.medium, 24.5 | 3 × t4g.medium, 73.5 |
| Agent nodes | 2 × t4g.medium, 49 | 2 × t4g.large, 98 | 3 × t4g.large, 147 |
| EBS gp3 | 7.5 | 10.5 | 16.5 |
| Public IPv4 | 11 | 7.5 | 7.5 |
| NLB | 0 (EIP on node) | 20 | 20 |
| NAT gateway + data | 0 (public nodes) | 38 | 38 |
| Snapshots | 3 | 5 | 8 |
| **Total** | **about 95** | **about 205** | **about 310** |

**Unchanged by the move**: platform RDS about 26; each tenant RDS about 14; S3, CloudFront,
Route53 and SES about 5 to 15 at current volume.

**Goes away**: flagship EC2 (12), the shared pool EC2 (12 to 98) and every dedicated tenant EC2
(12 or more each). On the cluster a dedicated tenant is a Deployment on shared nodes; cost grows
only when a node is added, roughly one t4g.large per 15 to 25 active tenants at current sizing.

A 1-year no-upfront compute savings plan takes about 30 percent off the node lines.

## 6. Open decisions

- NAT gateway for a fixed outbound IP, or cheaper public nodes.
- Explicit blue-green slot (Argo Rollouts) or the zero-downtime rolling update alone.
- When to add the first agent node and when to move to an HA control plane.
