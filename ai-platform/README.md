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
sudo /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=paddleocr \
  --output type=image,name=docker.io/jeffi/paddleocr:latest,unpack=true
kubectl apply -k deploy/overlays/razer                     # ConfigMap + manifests
kubectl -n ai-platform rollout restart deploy/ai-gateway deploy/paddleocr   # new images + new ConfigMap values
kubectl -n ai-platform rollout status deploy/ai-gateway
kubectl -n ai-platform rollout status deploy/paddleocr     # ready = PP-OCRv5 loaded
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
- `GET /v1/providers`: per capability (`text`, `image`, `video`, `stt`, `tts`, `embed`, `ocr`, `stock`) each provider's
  `configured`, `healthy` (razer) and `models`, plus `defaults` (each capability's order, `embed` its one provider).
- `GET /readyz` (or `/healthz?deep=1`): truthful dependency check, 503 + `reason` when Redis or
  every Ollama URL is unreachable. Cached for one probe interval so it never hammers Ollama.
- While Ollama is known down, `/v1/chat` (cache misses), `/v1/embed` and failed `/v1/vision` answer
  503 immediately instead of queueing, so the app falls back to direct Ollama without waiting.
- The app's `ai_health` cron (every 5 min) runs a real chat through the gateway plus a direct Ollama
  check and mails the platform admin once per incident, then once on recovery.

The gateway is published on `<host>:8080` (ServiceLB).

### Auth

With `AI_GATEWAY_TOKEN` set in `ai-gateway-secret`, every route except `/healthz` and `/readyz` (including
`/v1/files/:id`) needs `Authorization: Bearer <token>`, else 401. Unset = open. The app sends `AI_GATEWAY_TOKEN`
from its own env (Secrets Manager `jeffi/production` + `jeffi/store`), the SDK reads the same variable, and the
release script reads it from the Secret. To rotate, set the gateway to `new,old`, roll the app to `new`, then
drop `old`.

### OCR (PaddleOCR)

`POST /v1/ocr` `{data, mime_type?}` reads a document with PaddleOCR only (never a model, so the same file always
reads the same): `data` is bare base64 up to 12 MB, `mime_type` one of `image/png|jpeg|webp` or `application/pdf`
(default: sniffed from the bytes, else PNG; a PDF is read up to 10 pages). 200 `{ok: true, text, lines: [{text,
score}], meanScore, pages, model: 'PP-OCRv5', provider: 'paddleocr'}`, with `text: ''` when nothing is legible;
400 `{ok: false, error}` for a bad request, 503 when the sidecar is down or fails (`PADDLE_OCR_TIMEOUT_MS`, 120 s).
`/v1/vision` still tries PaddleOCR first and falls back to the Ollama vision model. `/readyz` and `/v1/providers`
report the sidecar (`ocr`); it never fails readiness.

The sidecar is `paddleocr/` (FastAPI on :8866, CPU image with the models baked in). `requirements.txt` pins the
whole tree (regenerate from `requirements.in` with the command at its top). Locally:
`pip install -r paddleocr/requirements.txt && python paddleocr/ocr_service.py` (Python 3.11+), then point
`PADDLE_OCR_URL` at `http://localhost:8866`.

### GPU guard (Razer only)

The single 12 GB GPU fits Ollama's models OR an ARC training run, not both, so training frees the
card by stopping/starting the host `ollama` service. `deploy/overlays/razer/host/` keeps the AI
service always up regardless: a systemd timer (`ollama-gpu-guard.timer`, every 60s) runs
`ollama-gpu-guard.sh`, which puts Ollama on the GPU when the card is free and pins it to CPU
(`CUDA_VISIBLE_DEVICES=`) whenever any non-Ollama process is using the GPU. Ollama never goes down;
it is only slower while training holds the card.

The same installer adds the k3s IP guard (`k3s-ip-guard.timer`, every 60s): the box is on home Wi-Fi
with a DHCP address and k3s keeps the node IP it started with, so after an address change pods lose the
API and CoreDNS stops learning new Services (a new Service never resolves). When the node IP and the
box's address disagree on two checks in a row, the guard restarts k3s and then CoreDNS (at most once per
30 minutes). `sudo k3s-ip-guard.sh --check` prints both addresses. Install both (idempotent, needs sudo
on the node):

```
deploy/overlays/razer/host/install-guard.sh
```

## Images and video

Routes (contract in `docs/plans/AI_MEDIA_PLATFORM_PLAN.md`; SDK: `generateImage`, `generateVideo`, `videoJob`):

- `POST /v1/images/generate` runs through the durable queue (one attempt; the router itself falls through
  providers). Order from `AI_IMAGE_PROVIDERS` (default `razer,google,replicate,azure`); unconfigured providers are
  skipped, a failing one falls through to the next, the answering one is returned as `provider`.
  `quality: premium` tries google first, `draft` tries razer first, `provider` pins one. Size is clamped to
  256..1536 in steps of 64, `n` to 1..4. An identical request in the same `namespace` is a free KV hit
  (`cache: 'kv'`) unless `seed` is set.
- `POST /v1/video/generate` starts an async job (state in Redis `ai:video:<jobId>`, 24 h TTL); a poller
  advances open jobs every `AI_VIDEO_POLL_MS`, and `GET /v1/jobs/:id` reads (and nudges) it.
- `POST /v1/images/stock` `{query, orientation?, minWidth?, perPage?}` searches free photo libraries in
  `AI_STOCK_PROVIDERS` order (default `pexels,pixabay`; keys `PEXELS_API_KEY`, `PIXABAY_API_KEY`, a library without
  its key is skipped). The first library with a hit at least `minWidth` wide answers `{results: [{provider, id, url,
  width, height, alt, photographer, photographerUrl, pageUrl}], provider}`; no key, no hits or failures answer 200 with
  `results: []`. Hits are cached 24 h in Redis per provider, query and orientation. Pixabay: photos only, safe search,
  AI-tagged hits dropped, `largeImageURL` only (1280 px; larger needs Pixabay's approval). The app copies the file to
  its own bucket (never hotlinks) and credits it (docs/plans/STOCK_IMAGES.md).
- `GET /v1/files/:id` serves generated bytes for `AI_FILES_TTL_SECONDS` (1 h). URLs are relative unless
  `AI_PUBLIC_URL` is set (the SDK resolves relative ones). The app must copy them to its own storage.
- `usage.costInr` is platform cost from `gateway/src/pricing.ts`, overridable with `AI_PRICES_JSON`
  (`{"provider":{"model or prefix or *":{"image":n,"video_second":n,"token_1k_in":n,"token_1k_out":n,"audio_minute":n,"tts_1k_chars":n}}}`).
  Razer and Ollama carry a small amortised compute cost. `/v1/chat` and `/v1/embed` return
  `usage: { promptTokens, completionTokens, costInr }` (cache hits cost 0); the audio routes return
  `usage: { units, unitType: 'audio_minute' | 'tts_1k_chars', costInr }`.

Providers:

| name | env | images | video |
|---|---|---|---|
| razer | `SD_WEBUI_URL` (A1111 `--api`), `SD_MODEL` | `/sdapi/v1/txt2img`, `img2img` with a reference | - |
| google | `GOOGLE_AI_API_KEY` | `gemini-3.1-flash-image` (`gemini-3-pro-image` for premium) via `/v1beta/interactions`; optional Imagen `:predict` fallback via `GOOGLE_IMAGEN_MODEL` | `veo-3.1-fast-generate-preview`, fallback `veo-3.0-generate-001`; 4/6/8 s, 16:9 or 9:16, 720p |
| replicate | `REPLICATE_API_TOKEN` | `black-forest-labs/flux-schnell` (draft), `flux-dev` (standard), `flux-1.1-pro` (premium) | `wan-video/wan-2.2-t2v-fast` (`wan-2.2-i2v-fast` with an image) |
| azure | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_IMAGE_DEPLOYMENT` / `AZURE_OPENAI_VIDEO_DEPLOYMENT` | gpt-image deployment: `/images/generations` (`/images/edits` with a reference); quality draft/standard/premium = low/medium/high; 1024x1024, 1536x1024 or 1024x1536 | Sora 2 on the v1 API (`/openai/v1/videos`), only when `AZURE_OPENAI_VIDEO_DEPLOYMENT` is set; 4/8/12 s, 1280x720 or 720x1280, text only |

## Text, embeddings and audio

| capability | default | providers |
|---|---|---|
| text, vision (`/v1/chat`, `/v1/chat/stream`, `/v1/vision`) | `AI_TEXT_PROVIDERS`, else `anthropic,razer,azure` (`razer,azure` without Claude auth) | anthropic (Claude), razer (Ollama by `modelHint`), azure (`AZURE_OPENAI_CHAT_DEPLOYMENT`, streamed over SSE) |
| embeddings (`/v1/embed`) | one provider, `AI_EMBED_PROVIDER` (`razer`), or `provider` per request | razer: Ollama `nomic-embed-text`; azure: `AZURE_OPENAI_EMBED_DEPLOYMENT` (text-embedding-3-small) at `dimensions: 768`, model id `text-embedding-3-small@768` (`<deployment>@768` for another deployment) |
| speech to text (`/v1/audio/transcribe`) | `AI_STT_PROVIDERS`, else `sarvam,azure` | sarvam: Saaras (`SARVAM_API_KEY`, `SARVAM_STT_MODEL` default `saaras:v3`; 23 Indian languages and en-IN, `unknown` detects; the REST route takes audio under 30 s, longer files fall through); azure: `AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT` (whisper / gpt-4o-transcribe), else Azure Speech short audio with `AZURE_SPEECH_KEY` (60 s, WAV or Ogg Opus) |
| text to speech (`/v1/audio/speak`) | `AI_TTS_PROVIDERS`, else `sarvam,azure` | sarvam: Bulbul (`SARVAM_TTS_MODEL` default `bulbul:v3`; 11 Indian languages, a default speaker per language, text over 2,500 characters sent in parts for mp3 and wav); azure: Azure Speech neural voices (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, default `centralindia`), one default voice per Indian language and en-IN; `AZURE_OPENAI_TTS_DEPLOYMENT` for an OpenAI voice name or as the fallback |

- **Azure means Microsoft-sold models only.** Every call names a deployment from the env above, never a model id;
  `AZURE_OPENAI_API_VERSION` defaults to `2025-04-01-preview`. A capability is configured only when the endpoint, the
  key and its deployment (or the Speech key) are set; an unconfigured one is skipped.
- Chat and vision follow the text order. Vision: cloud providers ahead of razer read the image in turn, and razer
  (PaddleOCR, then the Ollama vision model) ends the route.
- Embeddings never fall through to the other provider: vectors from two models can't be mixed, so an outage answers
  503 (razer down, azure unconfigured) or 502 (azure failed). The response carries `provider`, `model` and
  `dimensions`; store `model` with the vectors.
- `POST /v1/audio/transcribe` `{audioBase64, mimeType, language?, providers?}` (at most 25 MB of audio; `language` is
  BCP-47) answers `{text, language, durationSeconds, provider, model, usage}`. The length comes from the provider, else
  the file's headers (WAV, MP3, Ogg, MP4), else an estimate.
- `POST /v1/audio/speak` `{text, language, voice?, format?: 'mp3'|'wav'|'ogg', providers?}` (at most 5,000
  characters) answers `{audioBase64, mimeType, characters, provider, model, usage}`. A `voice` goes only to the provider
  it belongs to (an Azure voice name such as `hi-IN-SwaraNeural`, a Sarvam speaker such as `ishita`); the other one
  uses its default voice for the language.
- Sarvam follows docs.sarvam.ai (`POST /speech-to-text` multipart, `POST /text-to-speech` JSON, header
  `api-subscription-key`). Its gateway cost is Sarvam's pay-as-you-go list price in INR: ₹0.49 per audio minute, Bulbul
  v3 ₹3 and v4 Flash ₹2 per 1,000 characters.

### Model per provider

Every AI request may carry `models: { <provider>: <model id> }` (chat, stream, vision, images, video, transcribe,
speak); `/v1/embed` takes `model` for its one `provider`. The provider that answers uses its model; one not on that
provider's list for the capability is a 400 naming the allowed ids. `usage` and the response `model` are always the
model actually used. `GET /v1/providers` lists each provider's models per capability as
`models: [{ id, label, default? }]`:

| provider | text | image | video | stt / tts | embed |
|---|---|---|---|---|---|
| anthropic | `AI_ANTHROPIC_MODELS` (default `claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5`); without a choice each `modelHint` keeps its model | - | - | - | - |
| razer | the hint models plus Ollama's installed models (`/api/tags`, cached a minute; while Ollama has never answered any id passes) | `sdxl-turbo` | - | - | the embed model plus installed `*embed*` models |
| azure | `AZURE_OPENAI_CHAT_DEPLOYMENT` (default) + `AZURE_OPENAI_CHAT_DEPLOYMENTS` | `..._IMAGE_DEPLOYMENT(S)` | `..._VIDEO_DEPLOYMENT(S)` | `..._TRANSCRIBE_DEPLOYMENT(S)` / `..._TTS_DEPLOYMENT(S)`, plus `azure-speech-stt` / `azure-speech-tts` (Azure Speech) | `..._EMBED_DEPLOYMENT(S)` |
| google | - | the configured Gemini models, then those priced in `pricing.ts` (an `imagen-*` id uses `:predict`) | the Veo model and fallback, then the priced ones | - | - |
| replicate | - | Flux schnell / dev / 1.1 pro | Wan 2.2 t2v / i2v (an image request always runs i2v) | - | - |
| sarvam | - | - | - | `saaras:v3`, `saaras:v4` / `bulbul:v3`, `bulbul:v4-flash` | - |

A chosen model runs alone on its provider (no quality model, draft or Imagen fallback, no Speech/OpenAI swap); a
failure falls through to the next provider as usual. Vision uses the text models for anthropic and azure; razer keeps
`model` / `OLLAMA_VISION_MODEL`, since an Ollama text model may not read images. An empty list (a capability the
provider has no deployment for) checks nothing: the provider is skipped as unconfigured anyway.

### Razer circuit breaker

The gateway probes the LLM service's backends: Ollama (its pool, `OLLAMA_BASE_URLS`), SD (`SD_WEBUI_URL` +
`SD_WEBUI_HEALTH_PATH`, default `/sdapi/v1/options`, timeout `SD_HEALTH_TIMEOUT_MS`) and PaddleOCR (`PADDLE_OCR_URL`
`/health?ready=1`), every `RAZER_PROBE_INTERVAL_MS` (default the Ollama interval) and again right after a call
fails at the transport level. After `RAZER_BREAKER_FAILURES` (2) failed SD or PaddleOCR probes in a row, routing skips
razer for that capability (image for SD; `/v1/ocr` and the vision OCR step for PaddleOCR answer 503 at once); Ollama
uses the pool's own "known down" (text, vision, embed). The first good probe closes the breaker. `/healthz`,
`/readyz` and `/v1/providers` report each backend as `razer: {ollama, sd, paddleocr}` (`configured`, `ok`, `open`,
`reason`, `checkedAt`), and razer entries carry `healthy`.

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
`docs`/the app repo for the `ai_cache` schema (in `admin-service/database/tables/ai.sql`, applied to the local db).
