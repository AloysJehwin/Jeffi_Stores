# @jeffi/ai-platform

Tier-1 AI inference, packaged as a self-contained, cloud-portable unit. Fronts Ollama (chat,
embeddings, vision) and PaddleOCR with a durable, cached gateway so admin/user AI requests are
never lost, runs highly-available on the Razer box via Kubernetes, and lifts to cloud by changing
one URL.

## Shape

```
app (Next.js)  ──HTTP──▶  ai-gateway (k8s Deployment, 2+ replicas)
   imports @jeffi/ai-platform-sdk         │
   knows ONLY $AI_GATEWAY_URL             ├─ LLM cache: KV (Redis) + semantic (pgvector)
                                          ├─ durable queue (BullMQ on Redis, AOF): retry + DLQ
                                          ├─ Ollama  (GPU, models by hint)
                                          └─ PaddleOCR (OCR)
```

- **sdk/** — what the app imports. `aiChat() / embed() / vision() / health()`, same signatures as
  the old `src/lib/ai-client.ts`, so the app swap is signature-preserving. The SDK talks HTTP to
  the gateway and waits for the result; callers stay synchronous.
- **gateway/** — the always-on service. Two-tier cache in front of a durable queue in front of the
  providers. All host/model/provider knowledge lives here (moved out of the app).
- **deploy/** — kustomize: `base` + `overlays/razer` (k3s, single GPU box) + `overlays/cloud`
  (managed Redis/pgvector, cloud GPU pool). This directory IS the cloud migration.

## Never-lost

Every call is enqueued to Redis (AOF) before any model work. A job survives an Ollama pod restart
(rescheduled) and a gateway pod restart (another replica drains the queue). The HTTP handler waits
on the job, so the caller still `await`s one response. Exhausted retries → dead-letter → clean error
(never a hang).

## LLM cache

1. **KV** (Redis): exact-match on hash(model + messages + params). Cheapest, checked first.
2. **Semantic** (pgvector `ai_cache`): embed the prompt, ANN lookup, return on cosine ≥ per-hint
   threshold. Only for cacheable hints; agent/tool-calls and NL→SQL bypass it. `noCache` forces fresh.
3. Engine-level KV/prompt reuse via Ollama `OLLAMA_KEEP_ALIVE` (model stays warm). True paged-KV is a
   later vLLM swap — provider interface already isolates it.

## Deploy (Razer, k3s)

One-time node setup (Ubuntu 22.04, NVIDIA driver already installed):

```
sudo apt-get install -y nvidia-container-toolkit          # NVIDIA's apt repo
curl -sfL https://get.k3s.io | sudo sh -s - server --disable traefik --default-runtime nvidia
```

The bundled Traefik stays off because the host nginx owns :80. Ollama currently stays the host's
systemd service, because other GPU work on the box stops and starts it; the gateway targets the
node's `:11434` and the in-cluster `ollama` Deployment is kept at 0. To move Ollama into the
cluster, stop and mask the systemd unit and set the Deployment to 1: it runs with `hostNetwork` as
the `ollama` user over `/usr/share/ollama/.ollama`, so models are reused and `<host>:11434` callers
keep working. There is no registry: images are built on the box straight into k3s containerd and
run with `imagePullPolicy: Never`.

Build and roll out (from `ai-platform/` in an up-to-date checkout on the box). The tag never
changes (`:latest`, `imagePullPolicy: Never`), so a `rollout restart` is what picks up a new build:

```
pgrep buildkitd || sudo /opt/buildkit/bin/buildkitd --oci-worker=false --containerd-worker=true \
  --containerd-worker-addr=/run/k3s/containerd/containerd.sock --containerd-worker-namespace=k8s.io &
sudo /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=gateway \
  --output type=image,name=docker.io/jeffi/ai-gateway:latest,unpack=true
kubectl apply -k deploy/overlays/razer                     # ConfigMap + manifests
kubectl -n ai-platform rollout restart deploy/ai-gateway   # new image + new ConfigMap values
kubectl -n ai-platform rollout status deploy/ai-gateway
kubectl -n ai-platform logs -l app=ai-gateway --tail=50 | grep -E 'listening|ollama'
curl -s localhost:8080/readyz                              # 200 {"ok":true,...,"ollama":{"active":...}}
```

### Ollama addresses and health

`OLLAMA_BASE_URLS` is a comma-separated list (the old single `OLLAMA_BASE_URL` still works). The
gateway probes them in order (`GET /api/tags`), uses the first healthy one, re-probes every
`OLLAMA_PROBE_INTERVAL_MS` (and returns to an earlier URL once it recovers), and fails a request
over to the next URL on a connection error. It logs `ollama active: <url>` on every change and
`ollama UNREACHABLE: <reason>` when none answer. On the Razer the list is the k3s `cni0` bridge
(`10.42.0.1`, the host as seen from pods) then the Tailscale IP; never use the hostname, which once
resolved to a stale address and took every AI feature down while `/healthz` stayed green.

- `GET /healthz`: liveness only (process up); used by both k8s probes.
- `GET /readyz` (or `/healthz?deep=1`): truthful dependency check, 503 + `reason` when Redis or
  every Ollama URL is unreachable. Cached for one probe interval so it never hammers Ollama.
- While Ollama is known down, `/v1/chat` (cache misses), `/v1/embed` and failed `/v1/vision` answer
  503 immediately instead of queueing, so the app falls back to direct Ollama without waiting.
- The app's `ai_health` cron (every 5 min) runs a real chat through the gateway plus a direct Ollama
  check and mails the platform admin once per incident, then once on recovery.

The gateway is published on `<host>:8080` (ServiceLB).

### GPU guard (Razer only)

The single 12 GB GPU fits Ollama's models OR an ARC training run, not both, so training frees the
card by stopping/starting the host `ollama` service. `deploy/overlays/razer/host/` keeps the AI
service always up regardless: a systemd timer (`ollama-gpu-guard.timer`, every 60s) runs
`ollama-gpu-guard.sh`, which puts Ollama on the GPU when the card is free and pins it to CPU
(`CUDA_VISIBLE_DEVICES=`) whenever any non-Ollama process is using the GPU. Ollama never goes down;
it is only slower while training holds the card. Install (idempotent, needs sudo on the node):

```
deploy/overlays/razer/host/install-guard.sh
```

## Images and video

Routes (contract in `docs/plans/AI_MEDIA_PLATFORM_PLAN.md`; SDK: `generateImage`, `generateVideo`, `videoJob`):

- `POST /v1/images/generate` runs through the durable queue (one attempt; the router itself falls through
  providers). Order from `AI_IMAGE_PROVIDERS` (default `razer,google,replicate`); unconfigured providers are
  skipped, a failing one falls through to the next, the answering one is returned as `provider`.
  `quality: premium` tries google first, `draft` tries razer first, `provider` pins one. Size is clamped to
  256..1536 in steps of 64, `n` to 1..4. An identical request in the same `namespace` is a free KV hit
  (`cache: 'kv'`) unless `seed` is set.
- `POST /v1/video/generate` starts an async job (state in Redis `ai:video:<jobId>`, 24 h TTL); a poller
  advances open jobs every `AI_VIDEO_POLL_MS`, and `GET /v1/jobs/:id` reads (and nudges) it.
- `GET /v1/files/:id` serves generated bytes for `AI_FILES_TTL_SECONDS` (1 h). URLs are relative unless
  `AI_PUBLIC_URL` is set (the SDK resolves relative ones). The app must copy them to its own storage.
- `usage.costInr` is platform cost from `gateway/src/pricing.ts`, overridable with `AI_PRICES_JSON`
  (`{"provider":{"model or prefix or *":{"image":n,"video_second":n,"token_1k_in":n,"token_1k_out":n}}}`).
  Razer and Ollama carry a small amortised compute cost. `/v1/chat` and `/v1/embed` return
  `usage: { promptTokens, completionTokens, costInr }` (cache hits cost 0).

Providers:

| name | env | images | video |
|---|---|---|---|
| razer | `SD_WEBUI_URL` (A1111 `--api`), `SD_MODEL` | `/sdapi/v1/txt2img`, `img2img` with a reference | - |
| google | `GOOGLE_AI_API_KEY` | `gemini-3.1-flash-image` (`gemini-3-pro-image` for premium) via `/v1beta/interactions`; optional Imagen `:predict` fallback via `GOOGLE_IMAGEN_MODEL` | `veo-3.1-fast-generate-preview`, fallback `veo-3.0-generate-001`; 4/6/8 s, 16:9 or 9:16, 720p |
| replicate | `REPLICATE_API_TOKEN` | `black-forest-labs/flux-schnell` (draft), `flux-dev` (standard), `flux-1.1-pro` (premium) | `wan-video/wan-2.2-t2v-fast` (`wan-2.2-i2v-fast` with an image) |

`transparent: true` on an image request adds an isolate-the-subject hint to the prompt, then cuts each image out with
`REPLICATE_BG_REMOVAL_MODEL` (default `bria/remove-background`) on Replicate, whichever provider drew it. Without a
Replicate token such requests are rejected (400) rather than returned opaque.

Tests: `npm test` (vitest, all network mocked).

## Migrate to cloud

In cloud, Ollama runs as its own always-on GPU pod (the `base` Deployment on a GPU node pool), so
the Razer GPU guard is not used and nothing stops the model server. Deploy `deploy/overlays/cloud` (managed Redis + pgvector, cloud GPU node pool, cloud ingress) and
repoint `AI_GATEWAY_URL` in the app. No app redeploy beyond the URL; no code change.

## App wiring

The app's `src/lib/ai-client.ts`, `rag.ts` embed, and `admin-agent/vision.ts` call the SDK. The app
env shrinks to `AI_GATEWAY_URL` (+ `AI_PROVIDER` for the openai escape hatch). See
`docs`/the app repo for the `ai_cache` schema (in `database/ai.sql`, applied to the local db).
