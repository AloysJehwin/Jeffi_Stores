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

Build and deploy (from a copy of this repo on the box):

```
sudo /opt/buildkit/bin/buildkitd --oci-worker=false --containerd-worker=true \
  --containerd-worker-addr=/run/k3s/containerd/containerd.sock --containerd-worker-namespace=k8s.io &
sudo /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=gateway \
  --output type=image,name=docker.io/jeffi/ai-gateway:latest,unpack=true
kubectl apply -k deploy/overlays/razer
kubectl -n ai-platform rollout restart deploy/ai-gateway   # after rebuilding the image
```

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

## Migrate to cloud

In cloud, Ollama runs as its own always-on GPU pod (the `base` Deployment on a GPU node pool), so
the Razer GPU guard is not used and nothing stops the model server. Deploy `deploy/overlays/cloud` (managed Redis + pgvector, cloud GPU node pool, cloud ingress) and
repoint `AI_GATEWAY_URL` in the app. No app redeploy beyond the URL; no code change.

## App wiring

The app's `src/lib/ai-client.ts`, `rag.ts` embed, and `admin-agent/vision.ts` call the SDK. The app
env shrinks to `AI_GATEWAY_URL` (+ `AI_PROVIDER` for the openai escape hatch). See
`docs`/the app repo for the `ai_cache` schema (in `database/ai.sql`, applied to the local db).
