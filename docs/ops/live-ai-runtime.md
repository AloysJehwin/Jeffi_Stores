# Live runtime notes — AI assistant & on-device summary

Operational setup for production (EC2 `jeffi-ec2`, Docker Compose behind nginx).
These are **not fully captured in the container image** — record them here so a
fresh provision reproduces them.

## AI provider reachability (customer agent + RAG)

The chat model (`gemma4:12b`) and embedder (`nomic-embed-text`) run on **Ollama on
the Razer box**, reachable only over Tailscale. The app **containers cannot route
to the Tailscale network** (only the host can). To bridge this:

- A systemd unit **`ollama-forward.service`** on the EC2 host runs
  `socat TCP-LISTEN:11434,bind=172.18.0.1,fork,reuseaddr TCP:100.82.208.8:11434`
  — forwarding the docker-bridge gateway `:11434` to the Razer's Tailscale IPv4.
- `.env.production` points **both** at the forward:
  - `OLLAMA_BASE_URL=http://172.18.0.1:11434`
  - `RAG_OLLAMA_URL=http://172.18.0.1:11434`
- `OLLAMA_REQUEST_TIMEOUT_MS=20000` — fast-fail so a hung Ollama falls back to
  OpenAI (chat only; embeddings have no fallback).

**Dependency risk:** when the Razer box is asleep/offline, embeddings fail (no
fallback) → the agent returns "we don't carry anything". Durable fix: run Ollama
on always-on infra and repoint the two URLs.

## Retrieval quality

Pure vector search drifts on project-style queries ("wooden shelf" → woodworking
tools). `findSimilarProductIds` (src/lib/rag.ts) now does **hybrid keyword +
vector** search so literal fastener terms surface. No re-embedding needed.

## On-device checkout summary (Gemma 3 270M in the browser)

- Flag + model base are **build-time** (`NEXT_PUBLIC_*`), set as GitHub Actions
  repo **variables** and baked by CI via Docker build-args:
  - `NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY=true`
  - `NEXT_PUBLIC_ONDEVICE_MODEL_BASE=https://dm9rri2wgl1e.cloudfront.net/models/onboarding/v1`
- Model files hosted at `s3://jeffi-stores-bucket/models/onboarding/v1/` (weights,
  tokenizer, ORT runtime), served via CloudFront `dm9rri2wgl1e.cloudfront.net`
  with CORS allowing `https://jeffistores.in`.
- Changing the flag/base requires a **CI rebuild on main** (they're compiled in,
  not runtime env). Feature is progressive-enhancement: WebGPU + ≥4GB devices
  only; silent otherwise.
- To regenerate/retrain the model: `scripts/train-gemma-onboarding.py` +
  `scripts/export-gemma-onnx.py` on the RTX 4080, then re-upload to the S3 v-prefix.
