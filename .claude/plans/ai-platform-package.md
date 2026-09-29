# AI Platform package (Tier 1) — HA on Razer via k8s, portable to cloud

Branch: `fix/tenant-forms-host`. No commit/push without instruction. No emojis. Files < 500 lines.

## Goal
Turn Tier 1 (server-side model inference on the Razer box over Tailscale) into ONE self-contained
package/folder that:
- Runs always-available on the Razer box via full Kubernetes (kubeadm).
- Guarantees admin (and all) AI requests are never lost — gateway service + Redis-backed durable queue
  with retries.
- Adds an LLM caching layer (semantic response cache + exact KV cache; prompt-cache reuse where the engine
  supports it).
- Lifts to cloud (EKS/GKE) with minimal change — env-driven, same manifests, swap node pool + ingress.

## Decisions (confirmed)
- Package = infra manifests + a thin TS client SDK the Next.js app imports.
- Durability = a gateway service fronting Ollama + Redis queue (retries, survives model/node restarts).
- K8s = full upstream kubeadm on Razer; GPU via NVIDIA device plugin.
- App call model = SYNC wrappers (`aiChat/embed/vision` signatures unchanged); the gateway enqueues + waits
  (long-poll/SSE) so callers stay synchronous while durability lives inside the gateway.
- App migration = FULL SWAP now: rewrite the 11 consumers to the new SDK, delete old ai-client.ts/rag.ts
  model-call internals (keep public function names as SDK re-exports to bound the diff).
- LLM cache = added to the gateway (new requirement).

## Package layout — `ai-platform/` at repo root
```
ai-platform/
  README.md                      # architecture + run/migrate runbook
  sdk/                           # TypeScript client the Next.js app imports (@/ai-platform)
    index.ts                     # aiChat(), embed(), vision(), health() — same signatures as today
    types.ts                     # AiChatRequest/Response, EmbedRequest, VisionRequest (moved from ai-client.ts)
    transport.ts                 # HTTP to gateway: submit + await-result (SSE/long-poll), timeouts, retry
    config.ts                    # reads AI_GATEWAY_URL (+ per-model hints); no host/model logic in app
  gateway/                       # the always-on service (runs in the cluster)
    src/server.ts                # HTTP API: POST /v1/chat /v1/embed /v1/vision, GET /v1/jobs/:id, /healthz
    src/queue.ts                 # Redis (BullMQ) durable queue: enqueue, worker, retry/backoff, DLQ
    src/providers/ollama.ts      # calls Ollama /api/chat|/api/embeddings (moved from ai-client/rag)
    src/providers/paddleocr.ts   # PaddleOCR /ocr (moved from vision.ts)
    src/cache/                   # LLM CACHE LAYER (see below)
      kv.ts                      # exact-match KV cache (Redis): key = hash(model+messages+params)
      semantic.ts                # semantic cache: embed prompt, ANN lookup in pgvector, similarity gate
      policy.ts                  # per-modelHint TTL + cacheable/no-cache rules (agent/tool calls bypass)
    src/models.ts                # modelHint -> model name map (was inline in ai-client)
    Dockerfile
    package.json
  deploy/                        # k8s (kubeadm) manifests — the cloud target too
    namespace.yaml
    ollama.deploy.yaml + svc     # GPU requests, PVC for model weights, readiness on /api/tags
    paddleocr.deploy.yaml + svc
    gateway.deploy.yaml + svc    # replicas, HPA, readiness on /healthz, env from Secret/ConfigMap
    redis.yaml                   # or reuse existing cluster Redis; StatefulSet + PVC for durability
    ingress.yaml                 # Tailscale/ingress; cloud swaps to ALB/GCLB
    gpu-device-plugin.yaml       # NVIDIA k8s device plugin
    configmap.yaml + secret.example.yaml
    helmless-kustomization.yaml  # base + overlays: overlay/razer, overlay/cloud
  scripts/
    migrate-embeddings.mjs       # replaces scripts/embed-everything.mjs (points at gateway/embed)
```

## LLM cache layer (new)
Two tiers in the gateway, checked before hitting Ollama:
1. Exact KV cache (Redis): key = sha256(model + normalized messages + temperature + maxTokens + jsonMode +
   tools). Hit returns the stored completion. TTL per modelHint (copy/email long, agent short/none).
2. Semantic cache (pgvector): embed the prompt (nomic-embed-text), ANN search a new `ai_cache` table; if
   cosine >= threshold (per-hint, e.g. 0.97 copy / disabled for agent+sql) return the cached answer. Store
   new answers with their embedding. `ai_cache` (id, model, prompt_hash, embedding vector(768), response,
   model_hint, hits, created_at, last_used_at) goes in `database/ai.sql` next to the existing
   `embeddings` vector(768) table + an hnsw index in `database/indexes.sql`; applied to LOCAL db only.
Policy (`cache/policy.ts`): tool-calling/agent + NL->SQL bypass semantic cache (correctness-sensitive);
copy/email/pitch/affirmation/recap are cacheable. `no-cache` request flag to force fresh. Metrics: hit rate
per tier exposed on /metrics. (Engine-level prompt/KV reuse — Ollama keep_alive + num_ctx — configured on the
Ollama deployment; true paged-KV reuse is a later vLLM swap, noted in README, not built now.)

## Durability / never-lost
- Gateway accepts a job, writes it to the Redis queue (persisted, AOF on), returns a jobId AND holds the
  HTTP connection open (SSE/long-poll) until the worker completes -> caller still awaits synchronously.
- Worker: bounded retries with backoff on Ollama 5xx/timeout/unreachable; on repeated failure -> dead-letter
  queue + job marked failed (caller gets a clean error, not a hang). A job already enqueued survives an
  Ollama pod restart (k8s reschedules) and a gateway pod restart (another replica drains the queue).
- k8s keeps Ollama always-up (Deployment + readiness + GPU); the queue covers the seconds of restart.

## App integration (full swap)
- tsconfig currently maps only `@/* -> ./src/*`. Add a path `@ai-platform/* -> ./ai-platform/*` (and the
  matching jest/vitest alias) so the app imports `@ai-platform/sdk`. Alternative if we want zero tsconfig
  change: place the SDK at `src/ai-platform/sdk` (import `@/ai-platform/sdk`) and keep infra at root
  `ai-platform/deploy`. Decide at build start; plan assumes the `@ai-platform/*` alias.
- New import alias `@ai-platform/sdk` -> the SDK.
- Rewrite the 11 consumers (agent/chat, ai-fill-form, ai-enrich-field, ai-generate-email, campaigns/generate,
  campaigns/scenarios/generate, catalog-enrichment/*, customer-agent/chat, reviews/generate, ai-recap,
  ai-cart-insight, ai-pitch, ai-affirmation, products/search, recommendations, admin-agent/tools*,
  customer-agent/tools) plus rag.ts + vision.ts to call the SDK.
- Keep `src/lib/ai-client.ts` as a 3-line re-export shim of the SDK during transition to avoid a giant diff,
  then delete once green. rag.ts embed() + vision() likewise call the SDK.
- Env: app now needs only `AI_GATEWAY_URL` (+ AI_PROVIDER kept for the openai escape hatch). OLLAMA_*/RAG_*
  model+host env moves into the gateway's ConfigMap/Secret. Update deploy/load-secrets.mjs mapping + the
  jeffi/production secret keys (documented, not auto-applied to live).
- On-device Tier 2 (browser ONNX/Gemma) is untouched — it never hit Tier 1.

## Cloud portability
- Nothing app-side knows the host/model — only `AI_GATEWAY_URL`. Moving to cloud = deploy the same
  `deploy/` base with the `overlay/cloud` kustomize overlay (managed Redis/pgvector, cloud GPU node pool,
  cloud ingress) and repoint `AI_GATEWAY_URL`. No app redeploy needed beyond the URL.

## Verification (local, when asked)
- `tsc --noEmit` clean after the swap; run AI-touching tests (ai-client, rag, agent tools).
- Gateway unit tests: queue retry/backoff/DLQ; KV + semantic cache hit/miss/bypass policy.
- Manifests: `kubeconform`/`kubectl --dry-run=client` validate; do NOT apply to any live cluster here.
- No live writes; no secret changes applied to jeffi/production (documented only).

## Constraints
One branch, no commit/push until asked, no emojis, files < 500 lines, no schema in migrations/ (the
`ai_cache` pgvector table goes in a split schema file, applied to LOCAL db only), touch only Tier 1 wiring.
```
