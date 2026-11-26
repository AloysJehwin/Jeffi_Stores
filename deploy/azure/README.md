# Azure landing zone (Phase B) and the cross-cloud cluster (Phase C)

Plan and decisions: [`docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md`](../../docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md).

Everything here is written and checked, but **nothing has been created**. Each script is a dry run unless it gets `--apply`.

The existing `jeffi-ai-cin` resource group (Speech and OpenAI) is separate, and nothing here touches it.

## What is where

| Path | What it does |
|---|---|
| `main.bicep` | Subscription scope. Creates resource group `jeffi-prod-cin` (Central India), then the two modules below. |
| `modules/foundation.bicep` | VNet `10.60.0.0/16` with two subnets: `nodes`, and `postgres` (delegated). Also creates: <ul><li>an NSG that opens 80/443 and Tailscale UDP 41641 only;</li><li>a static Standard public IP;</li><li>Postgres 16 Flexible Server `jeffi-prod-pg` (B2s, 32 GB, private access, TLS required);</li><li>the `azure.extensions` allow-list (`pg_trgm`, `uuid-ossp`, `unaccent`, `vector`) and database `jeffi_stores`;</li><li>Key Vault `jeffi-prod-kv` (Standard, RBAC, purge protection), holding `pg-admin-password`;</li><li>three user-assigned identities, listed in the next table.</li></ul> |
| `modules/core-vm.bicep` | The k3s core: `Standard_E4ps_v6` (Arm, Cobalt 100), Ubuntu 24.04 arm64, Trusted Launch, P10 128 GB OS disk, accelerated networking, private IP `10.60.1.4`. Its system identity is Key Vault Secrets Officer. Only deployed with `deployCore=true`. |
| `cloud-init/core.sh` | Runs on the VM's first boot: <ol><li>installs Tailscale and joins as `jeffi-k8s-core-az`, a subnet router for the Postgres subnet and `168.63.129.16`;</li><li>installs the k3s server with `--flannel-iface tailscale0`, node IP = Tailscale IP, and `--kube-apiserver-arg service-account-issuer=https://oidc.jeffistores.in` plus the matching `service-account-jwks-uri`;</li><li>turns ServiceLB on for the core only.</li></ol>The k3s token and Tailscale key come from Key Vault `jeffi-production-k3s`. |
| `apply.sh` | Runs a preflight (subscription, providers, Epsv6 quota, SKU restrictions), then `az deployment sub what-if`. `--apply` deploys. `--core` adds the VM. It generates the Postgres admin password, or reads it back from the vault, and writes it into a 0600 parameters file. |
| `kv-sync.sh` | Copies every `jeffi/*` Secrets Manager secret to Key Vault under its dash name (`jeffi/production` becomes `jeffi-production`). It skips `jeffi/local*`, compares by sha256 and never prints a value. `--patch <secret> <KEY>` sets one JSON key from stdin. |
| `pg-init.sh` | Creates the `app_user` login, with its password generated straight into Key Vault (`pg-app-password`). Then: `azure_pg_admin` membership, ownership of `jeffi_stores`, and the four extensions. |
| `irsa/publish-oidc.sh` | Reads the cluster's discovery document and JWKS, checks the issuer, and uploads both to the `jeffi-oidc-issuer` stack's bucket. Then it invalidates CloudFront. |
| `irsa/aws-roles.sh` | Creates the IAM OIDC provider for `oidc.jeffistores.in`, plus one role per service account (next table). |
| `../aws/oidc-issuer.yaml` | CloudFormation for the issuer site: a private S3 bucket, CloudFront with origin access control, an ACM certificate and the Route 53 alias `oidc.jeffistores.in`. |
| `../aws/edge/` | The AWS tenant edge: <ul><li>`launch-edge.sh`: a t4g.small with an Elastic IP (`eip` subcommand) and a security group open on 80/443;</li><li>`edge-node-user-data.sh`: joins the core over Tailscale;</li><li>`route53-plan.sh`: store hosts to the edge, platform hosts to Azure, with a saved rollback batch.</li></ul> |
| `../k8s/overlays/azure/` | The platform on Azure, which `JEFFI_CLOUD=azure` selects. It adds: <ul><li>projected tokens for STS and Entra;</li><li>`SECRETS_BACKEND=keyvault`, `DB_IAM_AUTH=false` and `DB_SSL=require`;</li><li>cert-manager and ecr-refresh through IRSA;</li><li>CoreDNS forwarding for the Postgres private zone;</li><li>the provisioning ConfigMap for store nodes and pods (next section);</li><li>the edge (`../k8s/edge/`): its Traefik, and a `public-{slug}` copy of public-api with its own Redis, which the core's Traefik skips (`patches/traefik-core.yaml`).</li></ul> |

### Identities

| Identity | Subject | Grants |
|---|---|---|
| `jeffi-prod-github-deploy` (Entra) | `repo:AloysJehwin/Jeffi_Stores:environment:production` and `…:production-release` | Key Vault Secrets User; Reader on the group, so it can look up the Postgres address. |
| `jeffi-prod-cluster-apps` (Entra) | `system:serviceaccount:jeffi:jeffi-app` | Key Vault Secrets User. |
| `jeffi-prod-cluster-controller` (Entra) | `system:serviceaccount:jeffi:jeffi-stores-controller-service` | Key Vault Secrets Officer (`tenant-db-*`). |
| `jeffi-irsa-app` (IAM) | `jeffi:jeffi-app` | S3 (platform bucket, vault, mail inbound) and End User Messaging send. |
| `jeffi-irsa-controller` (IAM) | `jeffi:jeffi-stores-controller-service` | The same, plus the fleet config, WhatsApp templates and `jeffi-tenant-provisioning` (EC2/RDS store provisioning, `deploy/aws/tenant-provisioner-iam-policy.json`). |
| `jeffi-irsa-cert-manager` (IAM) | `cert-manager:cert-manager` | Route 53 DNS-01 in `jeffistores.in`. |
| `jeffi-irsa-ecr-pull` (IAM) | `jeffi:ecr-refresh` | ECR login and pull of `jeffi-stores-*`. |

On the core, pods can also use the VM identity through IMDS, as they use the EC2 instance role today. The federated path works on every node, including AWS ones.

### Stores on AWS, platform on Azure

Store pods and servers get no Entra identity. The controller runs with `SECRETS_BACKEND=keyvault`, and the provisioning ConfigMap (`patches/provisioning.yaml`) carries the rest:

| Setting | Effect |
|---|---|
| `SECRETS_BACKEND=keyvault` on the controller | Copies each secret a store's pods use into its namespace (`env-jeffi-store`, …) on every apply. Pods read it through `envFrom` with `SECRETS_BACKEND=env`. Writes each new node's k3s token and Tailscale key from `jeffi-production-k3s` into its user-data. |
| `K8S_NODES_OVER_TAILSCALE=true` | Store nodes run `tailscale up --accept-routes` and join with flannel on `tailscale0` at their Tailscale address. |
| `TENANT_PLATFORM_DB_IAM_AUTH=false`, `TENANT_PLATFORM_DB_SSL=require` | Store pods log in to the flagship Postgres with the password in their secret, over TLS. Their own database is unchanged. |
| `TENANT_NODE_CIDRS=100.64.0.0/10` | Each store's NetworkPolicy admits the Tailscale node addresses. |

Before the first store moves, put the Azure `DATABASE_URL` (and `CONTROL_PLANE_DATABASE_URL`, if set) into `jeffi-store`, `jeffi-messaging-production` and `jeffi-documents-production` too, with `kv-sync.sh --patch`.

## Founder steps before applying

1. **Owner.** Add admin@jeffistores.in as Owner on "Azure subscription 1".
2. **Resource providers.** Compute, Network, DBforPostgreSQL, KeyVault, ManagedIdentity and Storage are **NotRegistered** today (checked 2026-11-26). `apply.sh --apply` registers them.
3. **Quota.** After registration, run `bash deploy/azure/apply.sh`; it prints the Standard EPSv6 family quota in Central India.
   - The core needs 4 vCPUs.
   - Sponsorship subscriptions often start at 0–4. If it is short, request more in Portal → Quotas.
4. **Tailscale admin.**
   - **ACL:** allow `tag:ci` to reach the core on 6443, and `10.60.2.0/24:5432` and `168.63.129.16:53`.
   - **Auto-approve routes:** add `autoApprovers.routes` for `10.60.2.0/24` and `168.63.129.16/32` by `tag:server-prod`, or approve them by hand after step 4 of the runbook.
   - **Split DNS:** `postgres.database.azure.com` → `168.63.129.16`.
   - **Auth key:** check that `TS_AUTHKEY` in `jeffi/production/k3s` is a reusable, tagged key that has not expired.
5. **Anthropic federation.** Add a federation rule in the Anthropic console for issuer `https://oidc.jeffistores.in`, subject `system:serviceaccount:jeffi:ai-gateway`. It is the same kind of rule as `wif-voice`, and the gateway's token comes from this issuer once it runs on the Azure core.
6. **GitHub settings.**
   - Secrets: `AZURE_CLIENT_ID` (the `githubClientId` output), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `KUBECONFIG_AZURE_B64`. `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` are already set.
   - Variables: `AZURE_INGRESS_IP` (the `ingressIp` output, used until the DNS cutover). Set `AZURE_TARGET=true` last.

## Apply runbook (in this order)

Run from the repo root on the founder's Mac with `az` logged in (subscription "Azure subscription 1"), AWS credentials and Tailscale up.

1. **The issuer site on AWS.**
   ```bash
   aws cloudformation deploy --region us-east-1 --stack-name jeffi-oidc-issuer --template-file deploy/aws/oidc-issuer.yaml
   ```
   ACM validates through Route 53 in a few minutes. The issuer stays empty until step 7.
2. **Foundation.**
   ```bash
   bash deploy/azure/apply.sh            # preflight and what-if
   bash deploy/azure/apply.sh --apply
   ```
   Note the outputs: `ingressIp`, `postgresFqdn`, `tenantId`, `githubClientId`, `clusterAppsClientId` and `clusterControllerClientId`.
3. **Secrets.**
   ```bash
   bash deploy/azure/kv-sync.sh
   bash deploy/azure/kv-sync.sh --apply
   ```
   The dry run shows each secret, its size and whether it would be created, updated or left alone. Values are never printed. The VM's first boot needs `jeffi-production-k3s`.
4. **Core VM.**
   ```bash
   bash deploy/azure/apply.sh --core
   bash deploy/azure/apply.sh --core --apply
   ```
   Cloud-init waits up to 20 minutes for its Key Vault role, then installs Tailscale and k3s. Approve the two subnet routes in Tailscale if `autoApprovers` isn't set.
5. **Kubeconfig.**
   ```bash
   tailscale ssh jeffi@jeffi-k8s-core-az sudo cat /root/jeffi-azure.yaml > ~/.kube/jeffi-azure.yaml
   chmod 600 ~/.kube/jeffi-azure.yaml
   KUBECONFIG=~/.kube/jeffi-azure.yaml kubectl get nodes
   ```
   Then store the same file base64 as `KUBECONFIG_AZURE_B64`.
   Or run `bash deploy/azure/fetch-kubeconfig.sh --apply [--github]`. It never prints the file, and it falls back to `az vm run-command` when Tailscale SSH isn't allowed yet. Then run `bash deploy/azure/github-settings.sh --apply` to set the GitHub Azure secrets and `AZURE_INGRESS_IP`; add `--enable-target` only after the rehearsal. The tailnet ACL, route and SSH additions are in [`deploy/tailscale/README.md`](../tailscale/README.md).
6. **Database.**
   ```bash
   bash deploy/azure/pg-init.sh             # dry run
   bash deploy/azure/pg-init.sh --apply
   ```
   Then put the Azure connection details in `jeffi-production`, for example:
   ```bash
   bash deploy/azure/kv-sync.sh --patch jeffi-production DATABASE_URL --apply
   ```
   The value is typed and not echoed. Do the same for each Azure-specific key the app reads.
7. **Self-hosted IRSA.**
   ```bash
   bash deploy/azure/irsa/publish-oidc.sh --apply
   bash deploy/azure/irsa/aws-roles.sh       # prints trust and permission policies
   bash deploy/azure/irsa/aws-roles.sh --apply
   ```
8. **Overlay values.**
   - Fill `deploy/k8s/overlays/azure/azure.env` with the tenant id and the two cluster client ids.
   - Fill `patches/provisioning.yaml`: `K8S_SERVER_URL` is `https://<core Tailscale IP>:6443`, and `CLUSTER_INGRESS_IP` comes from step 10.
   - Commit. `lib.sh` and `apply-platform.sh` refuse to render while a `REPLACE_ME` is left.
9. **Cluster secrets and the platform** (the rehearsal of Phase D). The full rehearsal, with safe mode, its own allowlisted Key Vault, a fresh restore and the smoke and store round trip, is `deploy/azure/rehearsal/` (see its README). The manual commands are:
   ```bash
   KUBECONFIG=~/.kube/jeffi-azure.yaml bash deploy/k8s/bootstrap/secrets.sh
   JEFFI_CLOUD=azure bash deploy/k8s/bootstrap/apply-platform.sh "$(bash deploy/k8s/bootstrap/image-tag.sh)"
   ```
   From here on, set `AZURE_TARGET=true` so each release also runs DB · Azure, Deploy · Azure · prepare and Release · Azure.
10. **Tenant edge.**
    ```bash
    K8S_SERVER_URL=https://<core TS IP>:6443 NODE_SG=<K8S_NODE_SECURITY_GROUP> bash deploy/aws/edge/launch-edge.sh
    ```
    Then run it again with `--apply`. It prints the Elastic IP; that is `CLUSTER_INGRESS_IP` (step 8). Then:
    ```bash
    kubectl get node tenant-edge
    kubectl -n kube-system get ds traefik-edge
    ```
11. **Cutover (Phase E window).** `deploy/azure/cutover/cutover.sh` drives these steps: preflight, freeze, final dump and restore, identity, store re-join, DNS, CloudFront, smoke, unfreeze. `rollback.sh` reverses them; the checklist is in that folder's README. The manual equivalent:
    1. A day before:
       ```bash
       EDGE_IP=… AZURE_IP=… bash deploy/aws/edge/route53-plan.sh --lower-ttl --apply
       ```
    2. In the window: freeze, take the final dump and restore it, then run:
       ```bash
       EDGE_IP=… AZURE_IP=… bash deploy/aws/edge/route53-plan.sh --apply
       ```
       Point CloudFront's origin at `origin.jeffistores.in`, run the smoke tests, unset `AZURE_INGRESS_IP`, then unfreeze.
    3. Rollback: the batch the plan saved, under `~/Documents/db-backups/route53-rollback-*.json`.

**How CI reaches Azure** (needs the `tag:ci` rule from `deploy/tailscale/azure-acl-snippet.hujson`). `db-azure`, `deploy-prep-azure` and `release-azure` in `.github/workflows/ci.yml` use `.github/actions/azure-release-setup`. That action:
- logs in to Azure (federated);
- joins the tailnet as `tag:ci` with `--accept-routes`;
- installs psql;
- writes the kubeconfig;
- sets `JEFFI_CLOUD=azure`.

From there:
- `release-db.sh --cloud=azure` reaches Postgres directly over the subnet route. It takes `app_user`'s password from Key Vault through a temporary `PGPASSFILE`, so no password is in argv or the environment.
- `rollout.sh` and `smoke.sh` render the overlay and talk to the core's Tailscale address.
- The AWS jobs are unchanged.

## Monthly cost (from the plan, Azure retail Central India and AWS actuals, 2026-11-25)

### Azure, paid from the $5,000 credit

| Item | Recommended (this template) | Lean |
|---|---|---|
| k3s core VM | E4ps_v6: 4 vCPU, 32 GB, $88.33 | E2ps_v6: 2 vCPU, 16 GB, $44.24 |
| OS disk, P10 128 GB premium SSD | $19.71 | $19.71 |
| Static public IP | $3.65 | $3.65 |
| Postgres Flexible | B2s: 2 vCore, 4 GB, $71.54 | B1ms: 1 vCore, 2 GB, $17.89 |
| Database storage, 32 GB | $4.19 | $4.19 |
| Database backups, 7 days | $0 | $0 |
| Internet egress (first 100 GB free) | ~$0–5 | ~$0–5 |
| **Infrastructure subtotal** | **≈ $188/mo (≈ ₹17,900)** | **≈ $90/mo (≈ ₹8,600)** |
| Azure AI usage (OpenAI, Speech), estimate | $20–60 | $20–60 |
| **Total debited from the credit** | **≈ $210–250/mo** | **≈ $110–150/mo** |

- Key Vault costs a few cents a month.
- For the Lean column, set `vmSize=Standard_E2ps_v6` and `pgSku=Standard_B1ms`.

### AWS, paid by card, after the move

| Item | $/mo |
|---|---|
| Route 53 | ~1.1 |
| ECR storage | ~1.2 |
| SES | ~0.4 |
| S3 and CloudFront (with the issuer site) | ~0.5–1 |
| Cost Explorer API | ~0.1 |
| GST 18% | ~0.6–0.7 |
| **Subtotal** | **≈ $4–4.5/mo** |
| Tenant edge: t4g.small + Elastic IP (t4g.medium: ~$28) | ~$16 |

Store nodes stay on AWS and are charged to each store's wallet, as today. Secrets Manager (~$5.4/mo) goes once the cutover has settled.
