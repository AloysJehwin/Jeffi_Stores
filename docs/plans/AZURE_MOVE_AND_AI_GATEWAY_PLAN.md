# Azure move, AI gateway split and Azure AI providers

Status: plan, 2026-11-25. Phase B/C infrastructure written 2026-11-26, nothing created yet (see "Phase B/C status").

## Phase B/C status (2026-11-26)

**Applied 2026-11-26 (Phase B, Azure side):**
- **Foundation and core VM:** resource group `jeffi-prod-cin`, VNet and NSG, Key Vault `jeffi-prod-kv`, the identities, and static IP 52.172.147.62. The VM `jeffi-prod-core` is an E4ps_v6 (no zone pinned, since the sponsorship subscription blocks zones in Central India).
  - Tailscale name `jeffi-k8s-core-az` at 100.126.223.51. The routes 10.60.2.0/24 and 168.63.129.16/32 are approved.
  - k3s v1.37.2 is up with issuer `https://oidc.jeffistores.in`.
  - First boot gave k3s an empty `--node-external-ip`, because IMDS has no public IP for a Standard-SKU address. It was fixed on the VM, and `core.sh` now gets the IP from Bicep.
  - VM customData can't be changed in place, so `apply.sh --core` after a `core.sh` edit needs a rebuilt VM. Ordinary runs leave `--core` off.
- **Secrets:** `kv-sync.sh --apply` copied the 10 production secrets into Key Vault. The `*/local` developer secrets are skipped.
- **Postgres: not created.** B2s returns `SkuNotAvailable` in every zone. Support request 2611260030001583 (Region access with zonal dependency) is pending. Until it's approved, `DEPLOY_PG=false` skips Postgres. Then run `PG_ZONE=<n> bash deploy/azure/apply.sh --apply` and `pg-init.sh`.
- **Anthropic federation: one identity per environment** (founder, 2026-11-26). Every store uses it; spend is still charged per store by our own metering.
  - **Production:** workspace `jeffi-production` (`wrkspc_015htan8z4DDLDEQiUYJC6ci`) and service account `jeffi-production` (`svac_01HXWF7V5MmqFNXzAaxbofaH`).
    - Rule `jeffi-production-next` (`fdrl_015c1KmN69fVRfNYSuA5pZMF`) is on the Razer issuer.
    - Rule `jeffi-production-azure` (`fdrl_01QsmDKrzxm6y34Ho52LNwk5`) is on issuer `jeffi-azure-k3s` (`fdis_0167MVYogtxoLC6CGPJBJGne`; inline JWKS, JTI replay protection off, 1h), with subject `system:serviceaccount:jeffi:ai-gateway`.
    - The old rule `jeffi-production` (`fdrl_016JTDCM9cspPwrmpERLUVHQ`, old account jeffi-flagship) keeps serving until the release.
  - **Local:** workspace `jeffi-local`, service account `jeffi-local` (`svac_01LfjoK5ho82QqgeNVrpLrtk`), and rule `jeffi-local` (`fdrl_01J3WgQ2YoVatMdU2mzsnYp3`). Already switched in the local DB.
  - **Code:** `getAnthropicIdentity()` reads only the platform row. Migrations:
    - `2026-11-26_single_anthropic_identity.sql` drops per-store rows.
    - `2026-11-26_production_anthropic_service_account.sql` moves prod's row to the new account and rule.
  - **After that release:**
    - Archive the old `jeffi-production` rule, then rename `jeffi-production-next` to `jeffi-production`.
    - Archive the jeffi-flagship, jeffi-local-gateway and jeffi-t-testco service accounts, the `jeffi-t-testco` rule, and the `jeffi-t-testco` workspace.
  - **At the Azure cutover:**
    - Archive the Razer rule and rename `jeffi-production-azure` to `jeffi-production`.
    - Set the platform row's `federation_rule_id` to `fdrl_01QsmDKrzxm6y34Ho52LNwk5`, through a migration.
  - A rule's issuer can't be changed, and service account names can't be edited.
  - Re-register the inline key whenever the k3s service-account key rotates.
- **Node secret hygiene** (2026-11-26):
  - `launch-edge.sh` reads the k3s token and Tailscale key at launch, through `SECRETS_BACKEND` aws|keyvault, and writes them into the edge user-data. `--instance-secrets` keeps the old instance read.
  - The default store-node user-data turns tracing off (`set +x`) before the secrets are read, so they no longer reach the EC2 console log.
- **Overlay:** `azure.env` ids and `K8S_SERVER_URL` are filled. `CLUSTER_INGRESS_IP` waits for the AWS edge (step 10).
- **Still to do:** the kubeconfig over `tailscale ssh` (the ACL gives nobody SSH to tag:server-prod yet), Postgres, IRSA (step 7) and the tenant edge.

**Ready to apply.** Everything below is written and checked, and none of it is applied. The runbook, in order, is in [`deploy/azure/README.md`](../../deploy/azure/README.md).
- **Landing zone** (`deploy/azure/*.bicep`, `apply.sh`):
  - resource group `jeffi-prod-cin`, VNet and NSG (80/443 public; the k3s API, SSH and Postgres only over Tailscale), static IP;
  - the E4ps_v6 core with cloud-init (Tailscale subnet router, k3s server with flannel on `tailscale0`, issuer `https://oidc.jeffistores.in`);
  - Postgres 16 B2s, private, with the four extensions allow-listed;
  - Key Vault (RBAC) and the identities: GitHub deploy, plus cluster apps and controller through the k3s issuer.
- **Self-hosted IRSA:**
  - issuer site `deploy/aws/oidc-issuer.yaml` (S3 behind CloudFront; validated by CloudFormation);
  - `irsa/publish-oidc.sh` and `irsa/aws-roles.sh`, which create one role per service account: app, controller (with store provisioning), cert-manager, ecr-pull;
  - the pod side in `deploy/k8s/overlays/azure`, used only when `JEFFI_CLOUD=azure`. The AWS manifests render byte-identical.
- **Secrets:**
  - `kv-sync.sh` copies `jeffi/*` to Key Vault under dash names, dry run by default, values never printed;
  - `deploy/load-secrets.mjs` reads Key Vault when `SECRETS_BACKEND=keyvault`, through the one secrets library (`packages/store-core/src/lib/secrets/index.mjs`, `loadSecretEnv`), which both Dockerfiles copy to its repo path. The old `deploy/secrets-backend.mjs` shim is gone. On AWS the loader prints and loads exactly as before (an end-to-end test against a local Secrets Manager pins its lines), and a test keeps `kv-sync.sh`'s names equal to the library's.
- **AWS tenant edge** (`deploy/aws/edge`, `deploy/k8s/edge`): a Traefik DaemonSet on `jeffi.io/edge=true`, the launch and Elastic IP script, and a Route 53 plan with a saved rollback.
- **CI:**
  - `db-azure`, `deploy-prep-azure` and `release-azure` reach Azure over Tailscale;
  - `release-db.sh --cloud=azure` talks to Postgres over the subnet route, with the password from Key Vault in a temporary PGPASSFILE;
  - the AWS lanes are unchanged.

**Founder steps.**
1. Add admin@ as Owner.
2. Resource providers: Compute, Network, DBforPostgreSQL, KeyVault, ManagedIdentity and Storage are *NotRegistered* today. `apply.sh --apply` registers them.
3. Quota check: once Compute is registered, `apply.sh` prints the EPSv6 quota in Central India. The core needs 4 vCPUs.
4. Tailscale:
   - ACL for `tag:ci` to the core and the Postgres subnet;
   - auto-approve the core's routes;
   - split DNS for `postgres.database.azure.com`.
5. A new Anthropic federation rule for issuer `https://oidc.jeffistores.in`, subject `system:serviceaccount:jeffi:ai-gateway`.
6. GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `KUBECONFIG_AZURE_B64`. GitHub variables: `AZURE_INGRESS_IP`, then `AZURE_TARGET=true`.
7. The DNS cutover window:
   - lower TTLs the day before (`route53-plan.sh --lower-ttl`);
   - on the day, store hosts move to the edge and platform hosts to Azure;
   - CloudFront's origin moves to `origin.jeffistores.in`.

**Phase C follow-ups, done (2026-11-26).** All gated by configuration: the AWS deployment renders and behaves as before.
- **Database TLS for Flexible Server.** The overlay sets `DB_SSL=require` next to `DB_IAM_AUTH=false` on the platform services and the controller.
- **Store pods** (`tenant-workload.ts`, `tenant-compute.ts` `tenantPlatformLink()`). Store pods can't each get a Key Vault identity (Entra federated credentials need an exact subject, at most 20 per identity), so with the controller on `SECRETS_BACKEND=keyvault`:
  - the controller copies each secret the store's pods use (`jeffi/store` with its `jeffi/production` fallback, messaging, documents) from Key Vault into the namespace as `env-<name>` Secrets on every apply, and drops the ones no pod uses;
  - pods take them through `envFrom`, with `SECRETS_BACKEND=env`, so the boot loader fetches nothing; env set on the container still wins;
  - `TENANT_PLATFORM_DB_IAM_AUTH=false` and `TENANT_PLATFORM_DB_SSL=require` (provisioning ConfigMap) give the flagship database a password over TLS; the store's own database keeps its login (on-node Postgres: password; dedicated RDS: IAM);
  - `TENANT_NODE_CIDRS=100.64.0.0/10` lets Tailscale node addresses through each store's NetworkPolicy.
- **Store node cloud-init** (`node-user-data.ts`): with `K8S_NODES_OVER_TAILSCALE=true`, `tailscale up --accept-routes` and k3s `--flannel-iface tailscale0 --node-ip <Tailscale IP>`. With the controller on Key Vault, it reads `jeffi/production/k3s` (`jeffi-production-k3s`) through the secrets library at each launch and writes the k3s token and Tailscale key into the user-data, untraced; the node no longer calls Secrets Manager.
- **voice-service** reads `SM_SECRET_ID` from Secrets Manager or Key Vault (REST, workload identity or IMDS) by `SECRETS_BACKEND`, env first (`voice_service/secret_store.py`).
- **public-api on the edge** (`deploy/k8s/edge/shared-services.yaml`): a copy for `public-{slug}` hosts on `jeffi.io/edge=true`, with the edge's own Redis, routed by an IngressRoute labelled `jeffi.io/edge-only` that the core's Traefik skips. mobile has no store host today (only `mobile.jeffistores.in`, a platform host), so its edge copy is parked at 0 replicas.

**Still open.**
- **Edge node join** (`deploy/aws/edge/edge-node-user-data.sh`) still reads `jeffi/production/k3s` from Secrets Manager through its instance profile. Fine while Secrets Manager stays (until the cutover settles); before deleting it, have `launch-edge.sh` write the token in as the controller does.
- **Join secrets in user-data** are readable by anything on the node that reaches IMDS (pods too, at hop limit 2), the same reach the node's instance profile gives today. A short-lived k3s bootstrap token per launch would narrow it.
- **Bicep compile.** The templates were not compiled here, because the Bicep CLI isn't installed and `az bicep install` downloads it. Run that and `az bicep build --file deploy/azure/main.bicep` before the first `apply.sh`.

## 0. Decisions so far (founder, 2026-11-25)

**AI gateway split**
- The **AI gateway** becomes a platform pod in our own cluster. It holds every provider's settings, the routing and order, the endpoints, pricing and the cache.
- The **LLM service** is the Razer box: the self-hosted models (Ollama chat, vision and embeddings; SDXL-Turbo images; PaddleOCR).
- The gateway treats the LLM service as one provider (`razer`) among the cloud ones. If the Razer box is down, the gateway keeps serving through Anthropic, Azure, Google and the rest.

**Azure AI**
- Add Azure, meaning **Microsoft-sold models only**, as a provider for every category: text and chat, vision, image, embeddings and video where available.
- Add a new **audio** category: speech-to-text and text-to-speech.
- Azure AI Speech is also offered to voice-service.
- The existing provider order stays as it is. Azure is appended, and the order stays editable in Settings → Providers.

**Infrastructure**
- **Move EC2 (k3s) and RDS to Azure** at the Recommended size (D1 decided).
- **Move Secrets Manager to Azure Key Vault** (decided 2026-11-25).
- Route 53, CloudFront, S3, SES, End User Messaging and ECR stay on AWS.
- **No GPU VM on Azure.** The Razer box keeps the GPU work.
- **Embeddings move to Azure** (D2 decided). See §7 for store embeddings.
- **Store (tenant) provisioning stays on AWS** (decided 2026-11-25). Store nodes, their EBS Postgres and the optional dedicated RDS keep being created in AWS by the existing engine.
  - Only the platform moves: the core node, the flagship database and the secrets.
  - D3 is therefore settled: nothing to port.

**Credit**
- $5,000 Microsoft for Startups sponsorship credit, valid until 2028-11-23.
- It covers Microsoft-billed services only. Claude on Foundry and any other Azure Marketplace offer bill the card, so Claude stays on our Anthropic workload identity federation.

## 1. What exists today (from the code)

**AI**
- **Editable categories:** text, image and video. Settings → Providers sets the platform default; Ecom → Configuration holds per-store overrides; only the flagship administrator can change either. The order lives in `platform_provider_settings`, resolved by `packages/store-core/src/lib/providers/policy.ts`.
- **Text:** anthropic, then razer (Ollama).
- **Image:** razer, google, replicate.
- **Video:** google, replicate.
- **Embeddings:** Ollama `nomic-embed-text` only, with no provider choice. Stored vectors are `vector(768)`.
- **OCR:** PaddleOCR only, deliberately.
- **Audio:** no category, and no transcription or TTS anywhere. voice-service calls Sarvam and Anthropic directly.
- **Where the gateway runs:** on the Razer box at `100.82.208.8:8080` over Tailscale (`ai-client.ts`), so today **everything AI stops when the Razer box stops**.

**Infrastructure**
- **Compute:** one k3s core, `r7g.large` (2 vCPU, 16 GB, Arm, us-east-1).
- **Flagship database:** RDS `db.t4g.small`, Postgres 16.13 with IAM auth.
- **Stores:**
  - Each store runs on its own EC2 node, launched by our own EC2 client (`ec2-client.ts`, `tenant-compute.ts`).
  - Its Postgres runs as a pod on an attached EBS disk.
  - A dedicated-RDS option also exists (`aws-provider.ts`).
- **AWS credentials:** pods use the EC2 instance role for Secrets Manager (read at boot), RDS IAM tokens, S3, End User Messaging and Route 53 (cert-manager DNS-01).
- **Releases:** reach the cluster and RDS through SSM tunnels to the core.

## 2. Target architecture

```
                 Route 53 / CloudFront / S3 / SES / SMS / ECR / Secrets Manager   (AWS, unchanged)
                                         |
            Azure Central India (Pune) ---+--------------------------------------------
            k3s core VM (Arm)                         Postgres Flexible Server (flagship DB)
              storefront / admin / business / controller / messaging / documents / public-api
              ai-gateway (NEW here) --+--> Anthropic (WIF), Azure OpenAI + Speech, Google, Replicate, Pexels...
                                      +--> LLM service on the Razer box over Tailscale (Ollama, SD, PaddleOCR)
            store nodes (Arm VMs) with on-node Postgres on managed disks
```

Secrets live in Azure Key Vault:
- Pods read them through the VM's managed identity, the same model as today's EC2 instance role.
- Store nodes get their own identity, limited to their own secrets.
- Key Vault names allow only letters, digits and dashes, so `jeffi/production` becomes `jeffi-production`.

AWS credentials from Azure (still needed for S3, SMS/WhatsApp, Route 53 and ECR) come through a "self-hosted IRSA":
- The k3s service-account issuer is published as OIDC (JWKS on S3/CloudFront).
- AWS STS `AssumeRoleWithWebIdentity` then grants one IAM role per service account.
- The same issuer can later serve the Anthropic federation rules.

## 3. Phases

### Phase A: AI gateway split and Azure AI providers

Runs now on the current AWS cluster and doesn't wait for the move.

**A1. Gateway moves into our cluster**
- Deploy `ai-gateway` and `ai-redis` as platform services (`jeffi-stores-ai-gateway`). `AI_GATEWAY_URL` becomes the in-cluster service address.
- The Razer box keeps only the LLM service: Ollama, razer-sd and PaddleOCR, exposed over Tailscale.
- The gateway health-checks it. A circuit breaker skips `razer` while it is down, so the fallback order works without a 30-second timeout on every call.
- The direct-Ollama fallback in `ai-client.ts` goes away; the gateway owns fallback.
- **Anthropic federation:** the gateway now gets its identity token from our cluster's issuer, not Razer's k3s. That needs a new federation rule in the Anthropic console (founder), the same kind of step as `wif-voice`.
- The release moves from `razer-release.sh` to the normal platform rollout. The Razer box keeps a small script for its host services.

**A2. Azure provider in the gateway** (`ai-platform/gateway/src/providers/azure.ts`)
- **Text / chat / stream / vision:** Azure OpenAI chat deployments (the GPT family available to our resource).
- **Image:** `gpt-image` deployment, as a `MediaProvider.generateImage`.
- **Embeddings:** `text-embedding-3-small` with `dimensions: 768`, so it fits the current columns. Vectors from two different models can't be mixed, so embeddings become a **single selected provider** rather than an order. Switching re-embeds everything once (`embed_sync`). See decision D2.
- **Video:** Sora on Azure, if our region or Global deployment offers it. Otherwise skip.
- **Audio:**
  - Speech-to-text: Azure OpenAI transcription (Whisper / `gpt-4o-transcribe`) and Azure AI Speech.
  - Text-to-speech: Azure AI Speech neural voices, including Indian languages (hi, ta, te, kn, ml, mr, bn, gu, en-IN), and `gpt-4o-mini-tts`.
- **Credentials:** endpoint plus key in the gateway secret. Later, Entra workload identity through the same issuer.
- **Guard:** the adapter calls only deployments we created from Microsoft-sold models. There is never a Marketplace or partner model.
- The exact model and region list is confirmed at setup (`az cognitiveservices model list`). Models the Central India region lacks go on a Global Standard deployment.
- Pricing rows go in `pricing.ts`. Tests mirror `providers` and `provider-order`.

**A3. The audio category end to end**
- **SDK and gateway:** `AudioProviderName`, `/v1/audio/transcribe` and `/v1/audio/speak`, plus `audio` in `/v1/providers`.
- **Policy:** a new key `ai_audio_providers`, using the same tenant → platform → default resolution.
- **Billing:**
  - New capability `audio` with units `audio_minute` (STT) and `tts_1k_chars` (TTS).
  - The `ai_price_list` and `ai_usage` CHECK constraints are edited in place, with no migration.
  - The AI pricing admin page gains the new units.
- **UI:** an Audio order editor in `ProvidersCard` next to Text, Image and Video, plus an Embeddings selector.
- **First consumers:**
  - transcribing staff voice memos (`StaffVoiceMemo`);
  - audio and video files in the admin agent (`admin-agent/files.ts` says "no transcription model" today).

**A4. Azure Speech in voice-service**
- pipecat ships Azure STT and TTS services. Add the `azure` extra, an Azure option in `voice-settings.ts` / `voice-config.ts`, and the Outreach providers card.
- Sarvam stays the default. Azure becomes the fallback when Sarvam fails, and can be chosen per language.

**A5. Azure resources** (each created only after you approve it)
- Register Microsoft.CognitiveServices.
- Create one Azure AI Services (Azure OpenAI) resource with the chat, image, embeddings and transcription deployments.
- Create one Speech resource in Central India.
- Keys go into the gateway secret, never into git.

### Phase B: Azure landing zone (no customer traffic)

**Resource groups**
- `jeffi-prod-cin` in Central India.
- Register Microsoft.Compute, Network, DBforPostgreSQL and Storage.
- Check the Epsv6/Dpsv6 vCPU quota, which is often low on sponsorship subscriptions; request more if needed.

**Network**
- A VNet with subnets for nodes and for the delegated Postgres subnet (private access).
- NSG rules: 80/443 public, k3s API only over Tailscale.

**k3s core VM:** E4ps_v6 (Arm, so our arm64-only images run unchanged), Ubuntu 24.04 arm64, P10 disk, static IP. It joins Tailscale.

**Flagship database:** Postgres 16 Flexible Server, B2s, 32 GB.
- Allow-list `pg_trgm`, `uuid-ossp`, `unaccent` and `vector` in `azure.extensions`.
- TLS is required.

**Key Vault** `jeffi-prod-kv` (Standard, RBAC mode):
- Copy every `jeffi/*` secret across under dash names.
- The core VM identity gets "Key Vault Secrets Officer", because the controller creates and deletes `tenant-db-*` secrets.
- Store-node identities get "Secrets User", limited to their own secrets.

**Credential bridge to AWS:** the self-hosted IRSA from §2.
- Roles: S3, End User Messaging, Route 53 for cert-manager DNS-01, ECR pull. SES SMTP stays as it is.
- Every SDK client picks it up through the default credential chain (web identity token file).
- **ECR stays.** The `ecr-refresh` CronJob uses the ECR-pull role.
- Optional later: Azure Container Registry Basic ($5/mo from the credit) would remove the cross-cloud pull.

### Phase C: Make the code cloud-neutral

**Secrets**
- One secrets interface, with Secrets Manager and Key Vault behind it.
- It covers:
  - `deploy/load-secrets.mjs` (boot);
  - `lib/shared/db-secret.ts` (`tenant-db-*` create, read and delete);
  - node cloud-init (k3s token, Tailscale key);
  - `store-secret.sh` and `ensure-release-secrets.sh`;
  - the CI release steps.
- `SECRETS_BACKEND=keyvault` on Azure.

**Database connections**
- TLS is decided by config, not by "hostname contains `rds.amazonaws.com`" (`pools.ts`, `db.ts`, `tenant-registry/shared.ts`). Azure needs TLS too.
- Database auth uses a password from Secrets Manager. Entra tokens come later. `DB_IAM_AUTH`, `rds-signer` and `GRANT rds_iam` are dropped on Azure.

**Compute**
- A provider interface for nodes and disks:
  - AWS: today's `ec2-client.ts`.
  - Azure: VMs, Managed Disks and NSGs through Azure Resource Manager with a managed identity.
- `PROVISIONING_PROVIDER=azure`.
- Node cloud-init for Ubuntu arm64 on Azure: the disk is found under `/dev/disk/azure/scsi1/lun0`, and the k3s join token comes from Secrets Manager through the bridge.
- The capacity guard reads Azure per-family quotas.

**Prices and presets**
- Store sizes move to Azure SKUs:
  - Starter/Basic `D2ps_v6`, Medium `D4ps_v6`, Large `E4ps_v6`, X-Large `E8ps_v6`.
  - Disks: Premium SSD.
- A new `refresh-compute-prices.sh` reads the Azure Retail Prices API.
- `compute_prices` gets `azure:*` codes. Existing stores' `tenant_compute` specs are re-pointed by a data migration.
- Plan price floors are re-derived (Basic ₹2,081 came from AWS prices).

**Cleanup**
- Dedicated database for a store: see decision D3.
- Delete the legacy pre-k8s EC2 paths (`pool-autoscale.ts`, `ensureAppInstance`, the SSM push) and the retired shared-DB Starter.

**Releases**
- CI reaches the cluster over Tailscale (`TS_OAUTH_*`), not SSM.
- The `deploy/k8s/db` scripts connect over the tunnel with a password.
- `00-backup.sh` uses Flexible Server backups plus pg_dump to S3.
- A GitHub federated credential is added on Azure for the few Azure-side steps. A trimmed AWS deploy role keeps ECR push, Secrets Manager and CloudFront invalidation.

### Phase D: Rehearsal

- Restore a production dump into the Azure Postgres and bring the whole platform up on Azure, under a test hostname.
- Run the smoke, post-deploy and store-creation tests.
- Provision and delete a test store on Azure.
- Time the cutover steps.

### Phase E: Cutover (one announced window, about 30–60 minutes)

1. Lower DNS TTLs a day before. Freeze writes by putting the platform in maintenance mode.
2. Final pg_dump of the flagship database, restored into Flexible Server.
3. Move each live store's on-node Postgres from its S3 dump, taken fresh at freeze. Re-create its node on Azure.
4. Point the Route 53 records and `CLUSTER_INGRESS_IP` at the Azure IP.
5. Point CloudFront's origin at a stable `origin.jeffistores.in`.
6. Smoke-test, then unfreeze.
7. Keep AWS EC2 and RDS stopped but intact for 14 days as a rollback, then delete EC2, RDS, the EIP, EBS volumes and snapshots.

## 4. Monthly cost after the move

Prices are Azure retail (Central India) and AWS actuals, taken 2026-11-25. Azure's rate is ₹95.23/$.

### Azure, paid from the credit

| Item | Recommended | Lean (same size as today) |
|---|---|---|
| k3s core VM | E4ps_v6: 4 vCPU, 32 GB, $88.33 | E2ps_v6: 2 vCPU, 16 GB, $44.24 |
| OS disk, P10 128 GB premium SSD | $19.71 | $19.71 |
| Static public IP | $3.65 | $3.65 |
| Postgres Flexible | B2s: 2 vCore, 4 GB, $71.54 | B1ms: 1 vCore, 2 GB, $17.89 |
| Database storage, 32 GB | $4.19 | $4.19 |
| Database backups, 7 days (within storage size) | $0 | $0 |
| Internet egress (first 100 GB/month free) | ~$0–5 | ~$0–5 |
| **Infrastructure subtotal** | **≈ $188/mo (≈ ₹17,900)** | **≈ $90/mo (≈ ₹8,600)** |
| Azure AI usage (OpenAI and Speech), estimate | $20–60 | $20–60 |
| **Total debited from the credit** | **≈ $210–250/mo** | **≈ $110–150/mo** |
| How long $5,000 lasts | about 20–24 months | past the Nov 2028 expiry |

Notes:
- A store that buys its own server adds a node, for example D2ps_v6 at $33.73/mo plus its disk. That node is charged to the store owner's wallet at our margin.
- To verify on the first invoice: whether GST is charged on usage the credit covers.

### AWS, paid by card, after the move

| Item | $/mo |
|---|---|
| Route 53 (hosted zones and queries) | ~1.1 |
| ECR storage | ~1.2 |
| SES | ~0.4 |
| S3 and CloudFront (with functions) | ~0.5–1 |
| Cost Explorer API | ~0.1 |
| GST 18% | ~0.6–0.7 |
| **Total** | **≈ $4–4.5/mo (≈ ₹400)**, plus SMS and WhatsApp usage (about ₹0.44 per DLT SMS) |

Secrets Manager (~$5.4/mo today) is gone. Key Vault costs a few cents a month, paid from the credit.

**Today:** AWS is about $145/mo. November is $122.73 after 24 days: r7g.large $55, RDS $19, tax $19, the last support plan charge $8, and the rest.

**Out-of-pocket saving while the credit lasts:** about $140/mo, roughly ₹13,300.

**Overlap month:** the 14-day rollback period keeps EC2 and RDS charging about $50 extra once.

**After the credit ends**, around Nov 2028, the recommended size costs about $222/mo with GST, more than today's $145. Plan to right-size then, or use AWS Activate credits if they come through.

## 5. Risks and guards

- **Marketplace trap:** we create only Microsoft-sold deployments, and the adapter refuses anything else. Claude stays on Anthropic's own API with federation.
- **Spending limit off:** budget alerts were declined for now. They'll be offered again before the first billable resource is created.
- **Credential bridge:** if AWS STS is unreachable, new pods can't read secrets at boot. Running pods keep working. Same blast radius as today's instance role.
- **Media path:** the S3 bucket stays in us-east-1. Pages get faster (app and database in Pune), but server-side S3 reads cross the ocean. Moving the bucket region is a separate later step.
- **Scope:** Phase C touches the EC2 client, presets, the price catalog, about 17 UI files and about 17 test files. The rehearsal (Phase D) is mandatory before any cutover.
- **Account:** the subscription is under a personal Gmail login. Add admin@jeffistores.in as Owner first.

## 6a. Revised by the founder: stores stay on AWS (supersedes the store parts of §3 Phase C and of §6)

**One k3s cluster across both clouds, joined over Tailscale**
- The k3s server and the platform pods run on the Azure core VM.
- Store nodes stay in AWS, launched by the existing `ec2-client.ts` and `tenant-compute.ts`. They join with `K8S_SERVER_URL` set to the core's Tailscale address. Flannel runs over `tailscale0`.
- The controller provisions AWS stores through the IRSA bridge: an `jeffi-tenant-provisioning` role assumed with the cluster token.

**What drops out of Phase C:** the Azure VM and disk client, Azure SKUs, presets, prices, the quota check and the Azure node cloud-init. The existing AWS provisioning code stays.

**One cluster identity, trusted by both clouds**
- The k3s service-account issuer, published as OIDC, is trusted by AWS STS and by Entra (federated credentials).
- Every pod, on either cloud, can therefore get AWS roles (S3, SMS, EC2/RDS provisioning, Route 53, ECR) and Key Vault access, with no static keys.

**Store traffic (decision D4)**
- With the only ingress on the Azure core, every store page would go shopper → Pune → Virginia → Pune → shopper.
- **Recommended:** run Traefik on each AWS store node (and the pool node), with its own Elastic IP at ~$3.65/mo, passed to the store's wallet.
  - The store's DNS points at its node, so a store's traffic stays inside AWS.
  - Platform and flagship hosts keep pointing at Azure.

**Store traffic: revised recommendation, an "AWS tenant edge"**

Instead of an Elastic IP and Traefik on every store node, run one small always-on AWS node (t4g.small, or t4g.medium if it also hosts the store-facing shared services) as the store ingress.

**DNS**
- `*.jeffistores.in`, `*.business.jeffistores.in` and stores' custom domains point at the edge's Elastic IP. That is one wildcard record, as today.
- Flagship and platform hosts get explicit records to Azure: `jeffistores.in`, `ecom.`, `admin.`, `business.`, `public.`, `mobile.`, `forms.`, `invoice.`, …

**A shopper's request:** India → the edge in Virginia → the store's node in the same VPC → its pods and on-node Postgres → back. That's the same path and latency as today, and a store never depends on Azure to serve a page.

**Shared services that read store databases (public-api, mobile)**
- They also run a replica on the AWS side for store hosts.
- Otherwise every store API query would go Azure → AWS → Azure.

**What stays cross-cloud for stores**
- Control-plane lookups against the flagship database (plans, settings, templates, wallet). These are mostly cached; they get measured in the Phase D rehearsal, with more caching where a page path hits them.
- AI calls through the gateway (model latency dominates).
- Kubernetes control (deploys, rescheduling). If Azure is down, store pods and the edge keep serving.

**Cost:** about $16/mo (t4g.small + EIP), or about $28/mo with t4g.medium, on AWS. Spread across stores through plan pricing.

**Control-plane database access**
- Store pods read the flagship control plane over Tailscale.
- The core VM advertises the VNet's Postgres subnet as a Tailscale subnet route, so the database stays private.
- These are small, cached lookups.

**Secrets:** all in Key Vault. Store pods on AWS reach it through the same cluster identity.

## 6. Store provisioning and k3s after the move (original, before the founder's revision)

**Today**
- There is one k3s cluster.
- The core EC2 runs the k3s server (control plane), Traefik and the platform pods.
- Provisioning a paid store works like this:
  1. The controller calls the EC2 API to launch a node for that store.
  2. The node's cloud-init installs Tailscale and the k3s agent, and joins **the same cluster** with the k3s token.
  3. The controller creates an EBS disk, attaches it and mounts it for the store's Postgres.
  4. It applies the store's Kubernetes objects: storefront, admin, business, messaging and document pods, plus the Postgres pod pinned to that node.
- Route 53 points the store's hosts at the ingress IP, and Traefik on the core routes them to the store's pods.

**After the move:** the same cluster model. Only the cloud layer underneath changes.
- The k3s server runs on the Azure core VM.
- The controller calls Azure Resource Manager instead of EC2. It creates an Arm VM (Dpsv6/Epsv6) with cloud-init that joins the same cluster, plus an Azure managed disk for the store's Postgres.
- The controller acts as the core VM's managed identity, with a role limited to the `jeffi-prod-cin` resource group.
- **Unchanged:** everything above the VM. That covers the Kubernetes objects, routing, DNS, the store's S3 backups and the restore flow.
- **What changes in code:**
  - the node and disk client (`ec2-client.ts` becomes an Azure client behind a provider interface);
  - SKU names, presets and prices;
  - the quota check;
  - node cloud-init.
- **Existing stores:** at cutover each one gets a new Azure node, its Postgres is restored from its S3 dump, and its pods reschedule there.
- **The dedicated-database option (D3):** a store can pick a managed RDS database instead of the Postgres on its own server. That is the part that would need an Azure Flexible Server provider; dropping it for now keeps the move smaller.

## 7. Store (tenant) embeddings

**How they work today**
- Each store's product vectors live in **that store's own database**: the `embeddings` table, `vector(768)`, keyed by `source_table` and `source_id`, with a `content_hash`.
- The `embed_sync` cron runs every 30 minutes for stores with the AI storefront feature. It embeds only new or changed products, detected by content hash.
- `scripts/backfill-tenant-embeddings.ts --all` seeds existing stores.
- Embeddings go through the gateway's `/v1/embed`, today Ollama `nomic-embed-text` on the Razer box. Each call is metered to the store as `embed` usage.
- Customer-agent product search, admin catalog search and the admin agent read these vectors.

**Switching to Azure** (`text-embedding-3-small`, 768 dimensions)
- Vectors from two models can't be compared, so the switch is tracked per store:
  - a new `embedding_model` column on `embeddings` (table file, no migration);
  - search reads only rows of the current model and falls back to keyword search for the rest;
  - a backfill with `--force` re-embeds every store, one store at a time.
- The flagship's semantic cache (`ai_cache`) is flushed.
- Cost: about $0.02 per million tokens. A whole catalog costs cents, paid from the credit. Stores keep being metered as `embed` usage, as today.

## 8. Decisions needed (D1, D2 and D3 are now decided; D4 is open)

- **D4 Store traffic: decided 2026-11-25, the AWS tenant edge** (§6a). All store hosts and custom domains go to one small AWS edge node; flagship and platform hosts go to Azure.

Earlier list, kept for the record:

- **D1 Size:** Recommended (E4ps_v6 + B2s, about $188/mo) or Lean (E2ps_v6 + B1ms, about $90/mo). Recommended doubles CPU and memory, so the gateway and voice-service fit with headroom.
- **D2 Embeddings:** move to Azure `text-embedding-3-small` at 768 dimensions. This means one re-embed, and removes the Razer box as a single point of failure for search and RAG. Or keep nomic on the LLM service.
- **D3 Dedicated store database:** port to Flexible Server, or drop for now. With it dropped, every store uses on-node Postgres, as almost all do today.
- **Founder steps:**
  - add admin@ as Owner;
  - the Anthropic federation rule for the cluster issuer;
  - approve each Azure resource;
  - pick a cutover window.
