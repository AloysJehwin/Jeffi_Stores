# Azure landing zone (Phase B) and the cross-cloud cluster (Phase C)

Plan and decisions: [`docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md`](../../docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md).

Everything here is written and checked, but **nothing has been created**. Each script is a dry run unless it gets `--apply`.

The existing `jeffi-ai-cin` resource group (Speech and OpenAI) is separate, and nothing here touches it.

## What is where

| Path | What it does |
|---|---|
| `main.bicep` | Subscription scope. Creates resource group `jeffi-prod-cin` (Central India), then the two modules below. |
| `modules/foundation.bicep` | VNet `10.60.0.0/16` with two subnets: `nodes`, and `postgres` (delegated; unused unless `DEPLOY_PG=true`). Also creates: <ul><li>an NSG that opens 80/443 and Tailscale UDP 41641 only;</li><li>a static Standard public IP;</li><li>for the self-hosted Postgres: the 64 GB Premium data disk `jeffi-prod-pg-data`, the backup storage account `jeffiprodpgbackup` (container `pg-backups`) and the backup identity `jeffi-prod-pg-backup`;</li><li>only with `DEPLOY_PG=true`: a managed Postgres 16 Flexible Server `jeffi-prod-pg` (B2s, private access) with its `azure.extensions` allow-list and database;</li><li>Key Vault `jeffi-prod-kv` (Standard, RBAC, purge protection), holding `pg-admin-password`;</li><li>three user-assigned identities, listed in the next table.</li></ul> |
| `modules/core-vm.bicep` | The k3s core: `Standard_E4ps_v6` (Arm, Cobalt 100), Ubuntu 24.04 arm64, Trusted Launch, P10 128 GB OS disk, accelerated networking, private IP `10.60.1.4`. Its system identity is Key Vault Secrets Officer. Only deployed with `deployCore=true`. |
| `cloud-init/core.sh` | Runs on the VM's first boot: <ol><li>installs Tailscale and joins as `jeffi-k8s-core-az`, a subnet router for the Postgres subnet and `168.63.129.16`;</li><li>installs the k3s server with `--flannel-iface tailscale0`, node IP = Tailscale IP, and `--kube-apiserver-arg service-account-issuer=https://oidc.jeffistores.in` plus the matching `service-account-jwks-uri`;</li><li>turns ServiceLB on for the core only.</li></ol>The k3s token and Tailscale key come from Key Vault `jeffi-production-k3s`. |
| `apply.sh` | Runs a preflight (subscription, providers, Epsv6 quota, SKU restrictions), then `az deployment sub what-if`. `--apply` deploys. `--core` adds the VM. It generates the Postgres admin password (the self-hosted pod's superuser), or reads it back from the vault, and writes it into a 0600 parameters file. |
| `kv-sync.sh` | Copies every `jeffi/*` Secrets Manager secret to Key Vault under its dash name (`jeffi/production` becomes `jeffi-production`). It skips `jeffi/local*`, compares by sha256 and never prints a value. `--patch <secret> <KEY>` sets one JSON key from stdin. |
| `pg-disk.sh` | Attaches the data disk to the core VM and mounts it at `/var/lib/jeffi-pg` (the pod's hostPath). |
| `../k8s/overlays/azure/postgres.yaml` | The `flagship-postgres` StatefulSet and Service in `jeffi`, the 4-hourly backup CronJob and a NetworkPolicy. |
| `pg-init.sh` | Creates the k8s Secret `flagship-postgres` from Key Vault, waits for the pod, then creates the `app_user` login (password generated straight into Key Vault, `pg-app-password`), makes it owner of `jeffi_stores` and creates the four extensions as `jeffiadmin`. |
| `irsa/publish-oidc.sh` | Reads the cluster's discovery document and JWKS, checks the issuer, and uploads both to the `jeffi-oidc-issuer` stack's bucket. Then it invalidates CloudFront. |
| `irsa/aws-roles.sh` | Creates the IAM OIDC provider for `oidc.jeffistores.in`, plus one role per service account (next table). |
| `../aws/oidc-issuer.yaml` | CloudFormation for the issuer site: a private S3 bucket, CloudFront with origin access control, an ACM certificate and the Route 53 alias `oidc.jeffistores.in`. |
| `../aws/edge/` | The AWS tenant edge: <ul><li>`launch-edge.sh`: a t4g.small with an Elastic IP (`eip` subcommand) and a security group open on 80/443;</li><li>`edge-node-user-data.sh`: joins the core over Tailscale;</li><li>`route53-plan.sh`: store hosts to the edge, platform hosts to Azure, with a saved rollback batch.</li></ul> |
| `../k8s/overlays/azure/` | The platform on Azure, which `JEFFI_CLOUD=azure` selects. It adds: <ul><li>projected tokens for STS and Entra;</li><li>`SECRETS_BACKEND=keyvault`, `DB_IAM_AUTH=false` and `DB_SSL=require`;</li><li>cert-manager and ecr-refresh through IRSA;</li><li>CoreDNS forwarding for Azure DNS;</li><li>the provisioning ConfigMap for store nodes and pods (next section);</li><li>the edge (`../k8s/edge/`): its Traefik, and a `public-{slug}` copy of public-api with its own Redis, which the core's Traefik skips (`patches/traefik-core.yaml`).</li></ul> After the cutover only (`FLAGSHIP_CLOUD=azure`). |
| `../k8s/overlays/azure-standby/` | The same overlay before the cutover (`FLAGSHIP_CLOUD=aws`): the 61 app CronJobs suspended (`ecr-refresh` keeps running), messaging, documents and voice at 0, both annotated `jeffi.io/standby`. `lib.sh` and `apply-platform.sh` render it, and refuse to render Azure at all while `FLAGSHIP_CLOUD` is unset. The cutover's `azure-live` step applies the live CronJobs and Deployments in their place. |

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
   - **ACL:** allow `tag:ci` to reach the core on 6443. Postgres needs no rule: scripts use `kubectl port-forward` over the k8s API.
   - **Auto-approve routes:** add `autoApprovers.routes` for `10.60.2.0/24` and `168.63.129.16/32` by `tag:server-prod`, or approve them by hand after step 4 of the runbook.
   - **Split DNS:** not needed for Postgres any more (it was for `postgres.database.azure.com`).
   - **Auth key:** check that `TS_AUTHKEY` in `jeffi/production/k3s` is a reusable, tagged key that has not expired.
5. **Anthropic federation.** Done: rule `jeffi-production-azure` (`fdrl_01QsmDKrzxm6y34Ho52LNwk5`) trusts issuer `https://oidc.jeffistores.in`, subject `system:serviceaccount:jeffi:ai-gateway`. The cutover's identity step points the platform row at it.
6. **GitHub settings.**
   - Secrets: `AZURE_CLIENT_ID` (the `githubClientId` output), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `KUBECONFIG_AZURE_B64`. `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` come from a Tailscale OAuth client (Settings → Trust credentials, Keys › Auth Keys write, tag `tag:ci`); set each with `gh secret set <name>`, which prompts for the value. Both were set on 2026-11-26.
   - Variables: `AZURE_INGRESS_IP` (the `ingressIp` output, used until the DNS cutover). `AZURE_TARGET=true` and `FLAGSHIP_CLOUD=azure` are set at cutover, not before, by the cutover's `azure-live` step ([`cutover/README.md`](cutover/README.md)). Should `AZURE_TARGET` be set early, releases render Azure on standby (`overlays/azure-standby`): no app CronJob, no messaging, documents or voice worker, no stores, so nothing runs beside AWS. It still applies the platform to Azure on every release, so leave it unset.

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
   Note the outputs: `ingressIp`, `pgBackupClientId`, `tenantId`, `githubClientId`, `clusterAppsClientId` and `clusterControllerClientId`.
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
   Or run `bash deploy/azure/fetch-kubeconfig.sh --apply [--github]`. It never prints the file, and it falls back to `az vm run-command` when Tailscale SSH isn't allowed yet. The tailnet's SSH rule is `check`, so a non-interactive `tailscale ssh` waits for a browser re-auth; the fallback is the normal path from a script. Then run `bash deploy/azure/github-settings.sh --apply` to set the GitHub Azure secrets and `AZURE_INGRESS_IP`; add `--enable-target` only at cutover. The tailnet ACL, route and SSH additions are in [`deploy/tailscale/README.md`](../tailscale/README.md).
6. **Database** (self-hosted Postgres on the core; after the core VM, step 5's kubeconfig, and step 8's overlay values).
   ```bash
   bash deploy/azure/pg-disk.sh --apply     # attach and mount the data disk on the VM
   ```
   Fill `PG_BACKUP_CLIENT_ID` in `deploy/k8s/overlays/azure/azure.env` from the `pgBackupClientId` output of step 2. Then apply the StatefulSet, or let the release do it:
   ```bash
   kubectl --kubeconfig ~/.kube/jeffi-azure.yaml apply -f deploy/k8s/overlays/azure/postgres.yaml
   bash deploy/azure/pg-init.sh             # dry run
   bash deploy/azure/pg-init.sh --apply
   ```
   `pg-init.sh` creates the `flagship-postgres` Secret first: it must exist before the pod's first start (initdb reads it once), so if the pod is stuck on a missing Secret, run it, then `kubectl -n jeffi delete pod flagship-postgres-0`. The restore of the flagship dump is Phase D (`rehearsal/restore-dump.sh`).
   Its last step is `kv-sync.sh --azure-db --apply`. That points every service secret (`jeffi-production`, `jeffi-store`, messaging, documents, public-api, mobile) at this server as `app_user`, in `DATABASE_URL`, `CONTROL_PLANE_DATABASE_URL` and `MESSAGING_`/`DOCUMENTS_DATABASE_URL`, with the RDS IAM flags off. The Key Vault copies otherwise carry RDS IAM logins, and the store namespaces get copies of these secrets too. A later plain `kv-sync.sh --apply` keeps the overrides. The overlay also forces `DB_IAM_AUTH`, `RDS_IAM_AUTH` and `CONTROL_PLANE_IAM_AUTH` to false on the platform pods.
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
   JEFFI_CLOUD=azure bash deploy/k8s/bootstrap/ai-gateway-secret.sh
   JEFFI_CLOUD=azure FLAGSHIP_CLOUD=aws bash deploy/k8s/bootstrap/apply-platform.sh "$(bash deploy/k8s/bootstrap/image-tag.sh)"
   ```
   `ai-gateway-secret.sh` builds the gateway's `ai-gateway` Secret, which `secrets.sh` does not make. Without `ANTHROPIC_ORGANIZATION_ID` from it, the gateway skips Claude. Its `AI_CACHE_PG_URL` is the semantic cache's RDS URL; the cache is optional, so the gateway works without it, but point it at a database the core can reach to keep caching.
   `FLAGSHIP_CLOUD=aws` renders the standby overlay; without it the Azure render is refused. Leave `AZURE_TARGET` unset until the cutover (see the GitHub settings above).
10. **Tenant edge.**
    ```bash
    K8S_SERVER_URL=https://<core TS IP>:6443 NODE_SG=<K8S_NODE_SECURITY_GROUP> bash deploy/aws/edge/launch-edge.sh
    ```
    Then run it again with `--apply`. It prints the Elastic IP; that is `CLUSTER_INGRESS_IP` (step 8). Then:
    ```bash
    kubectl get node tenant-edge
    kubectl -n kube-system get ds traefik-edge
    ```
11. **Cutover (Phase E window).** `deploy/azure/cutover/cutover.sh` drives these steps: preflight, freeze, final dump and restore, identity, store re-join, DNS, CloudFront, smoke, azure-live (the app CronJobs and workers off standby, then the GitHub variables `FLAGSHIP_CLOUD=azure` and `AZURE_TARGET=true`, `AZURE_INGRESS_IP` deleted), unfreeze. `rollback.sh` reverses them; the checklist is in that folder's README. The manual equivalent:
    1. A day before:
       ```bash
       EDGE_IP=… AZURE_IP=… bash deploy/aws/edge/route53-plan.sh --lower-ttl --apply
       ```
    2. In the window: freeze, take the final dump and restore it, then run:
       ```bash
       EDGE_IP=… AZURE_IP=… bash deploy/aws/edge/route53-plan.sh --apply
       ```
       Point CloudFront's origin at `origin.jeffistores.in`, run the smoke tests, apply `overlays/azure`'s app CronJobs and messaging, documents and voice Deployments, set `FLAGSHIP_CLOUD=azure` and `AZURE_TARGET=true`, delete `AZURE_INGRESS_IP`, then unfreeze.
    3. Rollback: the batch the plan saved, under `~/Documents/db-backups/route53-rollback-*.json`.

**How CI reaches Azure** (needs the `tag:ci` rule from `deploy/tailscale/azure-acl-snippet.hujson`). `db-azure`, `deploy-prep-azure` and `release-azure` in `.github/workflows/ci.yml` use `.github/actions/azure-release-setup`. That action:
- logs in to Azure (federated);
- joins the tailnet as `tag:ci` (`--accept-routes` stays on, for the nodes' routes);
- installs psql;
- writes the kubeconfig;
- sets `JEFFI_CLOUD=azure`.

From there:
- `release-db.sh --cloud=azure` reaches Postgres through `kubectl port-forward` to `svc/flagship-postgres` (local port `AZ_PG_PORT`, 15433), so it needs only the k8s API. It takes `app_user`'s password from Key Vault through a temporary `PGPASSFILE`, so no password is in argv or the environment.
- `rollout.sh` and `smoke.sh` render the overlay and talk to the core's Tailscale address.

**Which lane releases** is set by two repository variables. The workflow passes `FLAGSHIP_CLOUD` on to the scripts, and Init's summary names the lanes.

| `FLAGSHIP_CLOUD` | `AZURE_TARGET` | Release |
|---|---|---|
| unset or `aws` (before the cutover) | unset | The AWS lane only, as before. |
| unset or `aws` | `true` (not planned) | The AWS lane, plus the Azure lane on standby: the flagship database and the platform from `overlays/azure-standby`. No stores, tenant fan-out, seed or CloudFront. |
| `azure` (set by the cutover's `azure-live` step) | `true` | The Azure lane is the release: DB · Azure · flagship and tenants (the fan-out Job in the Azure cluster, where the stores now are); Deploy · Azure · prepare (`store-secret.sh --check` on Key Vault, `build-secret.sh --check`, `platform prep`); and Release · Azure · \<service>, with the stores (`stores shared` in the controller's job, `stores <service>` after it), the template seed in messaging's job and the post-deploy browser smoke. CloudFront follows it. Every AWS job is skipped, Release · AWS · razer included (see below). |
| `azure` | unset | Refused by Init: no lane would release. |

After the cutover the scripts refuse the AWS side: `release-db.sh`, `rollout.sh`, `40-tenant-fanout.sh` and `50-seeds.sh` with `JEFFI_CLOUD=aws` and `FLAGSHIP_CLOUD=azure` stop before touching anything. Export `FLAGSHIP_CLOUD=azure` for Mac releases from then on (`JEFFI_CLOUD=azure`). The Azure deploy identity can read Key Vault but not write it, so Deploy · Azure · prepare only warns when `jeffi-store` lags `jeffi-production`. Write it from the Mac with `JEFFI_CLOUD=azure bash deploy/k8s/bootstrap/store-secret.sh` (Key Vault Secrets Officer).

**Razer after the cutover.** `razer-release.sh` reaches the Razer box over SSM through the AWS core, which stops at the cutover, so Release · AWS · razer is skipped from then on. PaddleOCR changes need a path through the Azure core first (open item in the plan).

## Backups and restore

The self-hosted flagship Postgres is protected by the CronJob `flagship-postgres-backup`: every 4 hours a `pg_dump -Fc` of `jeffi_stores` (plus the roles, `pg_dumpall --globals-only`) goes to `jeffiprodpgbackup/pg-backups/flagship/YYYY/MM/DD/`. Blobs are deleted after 30 days, with 7 days of soft delete on top. The disk itself has no snapshots, so these dumps are the recovery path (at most 4 hours of data lost).

Restore one (the login that ran `apply.sh` has Storage Blob Data Reader on the container; nothing else but the backup identity can read it):
```bash
az storage blob list --auth-mode login --account-name jeffiprodpgbackup -c pg-backups --prefix flagship/2026/ -o table
az storage blob download --auth-mode login --account-name jeffiprodpgbackup -c pg-backups \
  -n flagship/<YYYY>/<MM>/<DD>/jeffi_stores-<stamp>.dump -f ./jeffi_stores.dump
```
Then `pg_restore` through the port-forward, as `restore-dump.sh` does: `deploy/azure/rehearsal/restore-dump.sh --dump ./jeffi_stores.dump --target-db <db> --apply` (as `app_user`, extensions and the schema grant as `jeffiadmin`). To restore over the live database, stop the platform first and use `--reset`.

Do a restore drill monthly: restore the newest dump into a scratch database and compare table counts.

Operating notes:
- The StatefulSet's `updateStrategy` is `OnDelete`: a manifest change applies only after `kubectl -n jeffi delete pod flagship-postgres-0` (brief downtime while the pod restarts on the same disk).
- After a core VM rebuild, re-run `bash deploy/azure/pg-disk.sh --apply` before the pod can start; the data stays on the disk.

## Monthly cost (from the plan, Azure retail Central India and AWS actuals, 2026-11-25)

### Azure, paid from the $5,000 credit

| Item | Recommended (this template) | Lean |
|---|---|---|
| k3s core VM | E4ps_v6: 4 vCPU, 32 GB, $88.33 | E2ps_v6: 2 vCPU, 16 GB, $44.24 |
| OS disk, P10 128 GB premium SSD | $19.71 | $19.71 |
| Static public IP | $3.65 | $3.65 |
| Postgres data disk, P6 64 GB premium SSD (self-hosted on the core) | ~$10 | ~$10 |
| Postgres backup blobs (`jeffiprodpgbackup`) | < $1 | < $1 |
| Internet egress (first 100 GB free) | ~$0–5 | ~$0–5 |
| **Infrastructure subtotal** | **≈ $123/mo (≈ ₹11,700)** | **≈ $79/mo (≈ ₹7,500)** |
| Azure AI usage (OpenAI, Speech), estimate | $20–60 | $20–60 |
| **Total debited from the credit** | **≈ $143–183/mo** | **≈ $99–139/mo** |

- Key Vault costs a few cents a month.
- For the Lean column, set `vmSize=Standard_E2ps_v6`. All of it is Microsoft first-party, paid from the sponsorship credit.

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
