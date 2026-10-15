# Tenant-isolated AI layer (shared LLM, per-tenant data)

Design for the AI features so every store gets AI help over **its own data only** — no platform
or cross-tenant data in a tenant's answers. The models are shared; the data and adapters are
per-tenant. (#489)

## Principle

- **Shared** across tenants: the base model weights (on-device Gemma, and the gateway's hosted
  models). Identical bytes for everyone → no benefit to per-tenant copies.
- **Per-tenant** (never shared): the data the model reasons over (embeddings / RAG), any
  fine-tuned adapter (LoRA), and the response cache namespace.

## Components and how isolation is enforced

### 1. Server AI (admin agent, storefront helpers) → the ai-platform gateway
- `controller-service/src/lib/shared/ai-client.ts` calls the gateway (`AI_GATEWAY_URL`, the Razer box) for chat,
  embed, vision. The gateway is a shared service; it holds no per-tenant catalog.
- **Cache isolation**: `aiChat` sets `cacheNamespace = resolveTenantId() ?? 'platform'`, so the
  gateway's semantic response cache (`ai_cache.namespace`) is partitioned per tenant — a cached
  answer is never served across tenants.

### 2. RAG / embeddings — the data the agent reasons over
Two stores exist; the tenant's OWN DB is the source of truth:
- **Tenant DB `embeddings`** (pgvector, in `database/ai.sql`, applied to every tenant DB): written
  by catalog-enrichment (approve/bulk-approve) via the tenant pool, read by the admin agent's
  product search (`admin-agent/tools/index.ts`) via the tenant pool. Fully isolated — a tenant DB
  only ever contains that tenant's rows.
- **Shared replica (`rag.ts`, `jeffi_replica`)**: platform-only historical index. `rag.ts` filters
  every query by `tenant_id IS NOT DISTINCT FROM <current>` (platform = NULL) and `queryManyReplica`
  refuses on a tenant, so a tenant request never reads platform data. A tenant with no rows gets
  `[]` — never a platform fallback.
- `embeddings.tenant_id` + `UNIQUE(tenant_id, source_table, source_id)` lets the same source id
  exist once per tenant and makes platform rows explicit (`NULL`).

Backfill: `scripts/embed-everything.mjs --tenant <uuid>` (and `promote-enrichments.mjs`) stamp
`tenant_id`. Loading an existing tenant's catalog into its own DB is an ops run of these scripts.

### 3. On-device model (storefront, in-browser Gemma via WebGPU)
- Base weights: shared cache (identical for all stores).
- **LoRA adapter is per-tenant**: `controller-service/src/lib/on-device/keys.ts#onDeviceKeys(slug)` namespaces the
  adapter's IndexedDB key by store slug, so on a shared browser one store's fine-tune never loads
  into another's inference.
- **Fine-tuning now applies**: `summary.worker.ts` loads the saved LoRA (same tenant-namespaced
  key the fine-tune worker writes) after model init — previously the inference worker ignored the
  adapter, so fine-tuning was a no-op.
- The current store slug flows: `/api/store-config` (and SSR `app/layout.tsx`) → `StoreConfig.slug`
  → `setOnDeviceStore(slug)` → the worker `init` message.

## Boundaries / ops

- The gateway + the shared replica are external (the Razer box, `100.82.208.8`). This repo controls
  the per-tenant read/write routing and the namespacing; loading tenant data onto the replica (if
  ever used again) is an ops step. The go-forward store is the tenant's own DB.
- Capability gate (WebGPU/device memory) is real; on-device runs only on CAPABLE devices.

## Future work

- Per-tenant RAG at scale: as tenant DBs grow, the tenant-DB `embeddings` table + HNSW index is the
  path; the shared-replica path can be retired once no platform-only consumer needs it.
- A per-tenant adapter registry (server-issued LoRA) if fine-tuning moves server-side.
