# Moving from k3s to upstream Kubernetes (kubeadm)

_Written 2026-10-08. Status: **plan only — do when a trigger below is hit.** Current platform: see
[`K8S_MIGRATION_PLAN.md`](K8S_MIGRATION_PLAN.md) and [`deploy/k8s/README.md`](../deploy/k8s/README.md)._

k3s is certified Kubernetes, so the workloads (Deployments, Services, HPAs, NetworkPolicies, Traefik
IngressRoutes, cert-manager Certificates) move unchanged. What changes is **how the cluster is
assembled**: k3s bundles pieces that kubeadm leaves to us.

## When to do this

Any one of:
- **Control-plane HA required.** For example an SLA promised to Enterprise tenants, or the single core node becomes the main outage risk. (k3s can also run 3 servers, so check that cheaper option first.)
- **More than ~15–20 nodes**, or tenant count where one 8 GB core node can't host the control plane, Traefik, observability and the flagship.
- **A customer or compliance requirement** names upstream Kubernetes, or a CNI feature k3s's defaults lack.
- **Moving to managed EKS.** Most of this plan applies too; skip the control-plane sections.

Not a reason: "k3s isn't real Kubernetes". It passes the same conformance tests.

## What k3s provides today → kubeadm replacement

| k3s built-in | Used for | kubeadm replacement |
|---|---|---|
| Embedded etcd + `--etcd-snapshot-*` | Cluster state + 6-hourly snapshots | **etcd stacked on 3 control-plane nodes** (kubeadm default). Snapshots via a CronJob running `etcdctl snapshot save` → S3 (`jeffi-stores-mtls-truststore/k8s-etcd/`). |
| Flannel (VXLAN, UDP 8472) | Pod network | **Cilium** (eBPF; also replaces kube-proxy and enforces NetworkPolicy; Hubble flow view). Calico is the conservative alternative. Open its ports in the node SGs instead of 8472. |
| kube-router NetworkPolicy controller | Tenant isolation (`isolate` policy in `tenant-workload.ts`, `42-netpol.yaml`) | Cilium enforces the same objects. **Re-run the cross-tenant isolation test.** |
| Bundled **Traefik** + `HelmChartConfig` (`10-traefik.yaml`) | Ingress, mTLS TLSOptions, IngressRoutes | **Traefik Helm chart** installed in `kube-system` with the same values. Keeping the `kube-system` namespace means the NetworkPolicies that allow ingress "from kube-system" keep working; if it moves, update `42-netpol.yaml` and `tenant-workload.ts` (`isolate` policy). |
| ServiceLB (`svclb-traefik`) binding host 80/443 | Public entry on the core EIP | Traefik with `hostNetwork`/`hostPort` on **dedicated ingress nodes** with EIPs, or an **AWS NLB** (aws-load-balancer-controller). An NLB (~$18/mo) removes the single-node entry point. |
| `HelmChart` CRs (`20-cert-manager.yaml`, `50-observability.yaml`) | Installing cert-manager, Coroot operator, Headlamp | Plain `helm upgrade --install` (CI step or a tiny `helmfile.yaml`). Values copy over verbatim. |
| `local-path` StorageClass (`41-redis.yaml`, Coroot/ClickHouse PVCs) | Persistent volumes on the node disk | **AWS EBS CSI driver** + `gp3` StorageClass. Volumes then survive node replacement. Update `storageClassName` in `41-redis.yaml` and the Coroot spec. |
| Bundled metrics-server | HPA (flagship 2→4, Pro/Enterprise tenants), `kubectl top`, admin Infrastructure tab | metrics-server Helm chart. |
| CoreDNS | Service DNS | kubeadm installs CoreDNS. No change. |
| `get.k3s.io` join with a static `K3S_TOKEN` (`core-node.sh`, `src/lib/k8s/node-user-data.ts`) | Nodes join on boot | `kubeadm join` with a **bootstrap token (24 h TTL)** + CA hash. See "Node join" below. This is the main code change. |

## Code and config that change

| File | Change |
|---|---|
| `src/lib/k8s/node-user-data.ts` | Replace the k3s install with: install containerd + kubelet/kubeadm (pinned version), then `kubeadm join <api>:6443 --token … --discovery-token-ca-cert-hash …` with a `JoinConfiguration` carrying `nodeRegistration.kubeletExtraArgs.node-labels` and `taints` (same labels and taints as today). Keep Tailscale. |
| `src/lib/k8s/tenant-compute.ts` | Before `launchNode`, mint a short-lived bootstrap token through the API (a `bootstrap-token-<id>` Secret in `kube-system`, TTL ~1 h) and pass it in user-data. RBAC: allow the flagship SA to create those Secrets in `kube-system` only. |
| `deploy/k8s/bootstrap/core-node.sh`, `launch-core.sh` | Become `control-plane.sh` (kubeadm init/join `--control-plane`, 3 nodes behind an internal NLB or keepalived VIP) and `ingress-node.sh`. |
| `deploy/k8s/platform/10-traefik.yaml`, `20-cert-manager.yaml`, `50-observability.yaml` | Convert `HelmChart`/`HelmChartConfig` to Helm values files and install with helm. |
| `deploy/k8s/platform/41-redis.yaml` (+ Coroot storage) | `storageClassName: gp3`. |
| `deploy/k8s/bootstrap/rollout.sh`, `.github/workflows/ci.yml` | Add `helm upgrade` for the platform charts. Comments/names say k3s. Kubeconfig points at the new API endpoint. |
| `deploy/k8s/README.md`, `docs/SAAS_MULTITENANT_STATUS.md` | Runbook rewrite. |

**Unchanged:** `tenant-workload.ts` rendering, CronJobs, flagship Deployment, mTLS edge, OpenTelemetry, IAM, ECR, DNS.

### Node join (the one real design change)
k3s nodes join with a long-lived secret token. kubeadm tokens expire (default 24 h), which is safer:
1. The provisioner creates a bootstrap token Secret (`kube-system/bootstrap-token-<6 chars>`, `expiration` +1 h, usages `authentication,signing`, groups `system:bootstrappers:kubeadm:default-node-token`).
2. User-data receives the token plus the CA cert hash (stored once in `jeffi/production/k8s` as `CA_CERT_HASH`).
3. The token expires on its own; no rotation needed.

## Target architecture and cost (us-east-1, on-demand)

| Role | Instances | Monthly |
|---|---|---|
| Control plane (etcd + API), HA | 3 × t4g.medium | ~$74 |
| Internal API load balancer | NLB (or a keepalived VIP, $0) | ~$18 or $0 |
| Ingress + platform (Traefik, cert-manager, Coroot, Headlamp, flagship) | 1–2 × t4g.large | $49–98 |
| Public entry | NLB for Traefik (optional, removes single-node ingress) | ~$18 |
| EBS gp3 for PVCs | ~40 GB | ~$3 |
| **Delta vs today's single t4g.large core** | | **≈ +$75 to +$160 /month** |

Tenant nodes (pool-basic, dedicated) cost the same as today. Needs an EC2 vCPU quota of about **16+**.

## Migration (blue/green — the old cluster stays live until cutover)

1. **Build the new cluster beside the old one.** 3 control-plane nodes, Cilium, metrics-server, EBS CSI, Traefik, cert-manager, Coroot, Headlamp. Verify with `kubectl get nodes`, Cilium connectivity tests and a test pod.
2. **Secrets and config.** Re-run `deploy/k8s/bootstrap/secrets.sh` against the new kubeconfig and copy the `provisioning` ConfigMap (new API URL, SGs, AMI).
3. **Platform.** Apply `deploy/k8s/platform` with the new storage class and Helm-based charts. Wait for the wildcard cert. Run the flagship with **CronJobs suspended**.
4. **Verify via `curl --resolve`** against the new ingress IP: storefront, `admin.` mTLS, `admin-{slug}`, vault, `/api/ready`, AI over Tailscale, traces in Coroot. Run the k6 shopper test (`scripts`/scratch `shoppers.js`).
5. **Tenants.** For each tenant namespace, re-render on the new cluster (`applyTenantWorkload`) and launch its node there. Tenant data is in RDS/S3, not the cluster, so moving a tenant is just reschedule + DNS (the wildcard already covers it).
6. **Cutover.**
   1. Point the CloudFront origin and the `*.jeffistores.in`/`admin`/… records at the new ingress.
   2. Suspend the old cluster's CronJobs and resume the new ones.
   3. Watch Coroot.
   4. Keep the old core node **stopped** for a week as the rollback path.
7. **CI.** Switch `KUBECONFIG_B64` to the new cluster. Delete the old cluster after the rollback window.

**Rollback:** point DNS/CloudFront back to the old core EIP and resume its CronJobs. Same as the k3s cutover runbook.

## Verification checklist
- [ ] `kubectl get nodes`: 3 control-plane nodes Ready, plus ingress and tenant nodes.
- [ ] Remove one control-plane node and confirm the API stays up (the HA proof).
- [ ] etcd snapshot CronJob writes to S3; a restore was rehearsed once.
- [ ] Cross-tenant NetworkPolicy test: a pod in tenant A cannot reach tenant B's Service or Redis.
- [ ] New tenant lifecycle (Basic → Enterprise → delete): node joins with a fresh bootstrap token, pods schedule, the token expires.
- [ ] HPA scales the flagship under the k6 test.
- [ ] Coroot and Headlamp show all nodes; traces arrive.
- [ ] Redis PVC survives deleting its node (EBS re-attach).

## Effort
About 3–5 focused days: 1 for the cluster, 1 for Helm conversion, storage and ingress, 1 for the join-token code and tests, and 1–2 for tenant migration, verification and cutover. Do it outside a sale or campaign.
