# ADR-0002: On-device checkout recap (browser-run Gemma 3 270M)

- **Status**: Accepted (implemented behind a flag)
- **Date**: 2026-07-20
- **Authors**: eng
- **Related**: ADR-0001 (server-side re-ranker/fine-tune) — this is a *separate* pipeline.

## Context

We want a personalized "cart recap" on the checkout review page. Rather than a
cloud LLM call (latency + cost + sending cart data off-device), we run a tiny
fine-tuned **Gemma 3 270M** **entirely in the customer's browser** via
transformers.js + WebGPU. The shopper's session data never leaves their device.

## Decision

Ship an on-device recap that is:
- **Flag-gated** — `NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY` (off by default). When
  off, nothing runs: no probe, no download, no tracking, no UI.
- **Capability-gated (strict)** — WebGPU adapter + `navigator.deviceMemory >= 4GB`
  + GPU buffer-limit checks (`src/lib/on-device/capability.ts`). Fails silently.
- **Background / non-blocking** — the model loads and generates in a Web Worker
  (`summary.worker.ts`); checkout is never blocked. Silent progressive
  enhancement: the card appears only when a capable device produces output.
- **Lazy + cached** — the ~400MB quantized ONNX downloads on first use and is
  cached by the browser; incapable devices never fetch it.

## Pipeline (build-time, offline — NOT in prod)

1. **Dataset** — `scripts/gen-onboarding-dataset.mjs` samples the **local** catalog
   (guarded against live) and renders synthetic `(session → recap)` pairs in the
   approved voice. Output JSONL, 90/10 split.
2. **Fine-tune** — `scripts/train-gemma-onboarding.py`: LoRA on `google/gemma-3-270m`
   on the RTX 4080, merged to full weights.
3. **Export** — `scripts/export-gemma-onnx.py`: optimum → ONNX → int8 quantize →
   transformers.js layout. Hosted statically at `public/models/onboarding/`.
4. **Runtime** — `src/lib/on-device/{runtime,summary.worker}.ts` load & run it.

**Production does zero training and zero inference** — it only serves static model
files. The GPU box is a build tool, exactly like image generation. Re-running the
fine-tune + redeploying the files is how the model is ever updated.

## Privacy (extends ADR-0001's PII constraint)

- **Training data**: synthetic, catalog-derived — no real customers, no PII.
- **Inference inputs**: aggregated/anonymized session signals (product/category/
  brand names, counts, totals, search terms) — never names, addresses, emails,
  phone. Serialized by the single-source-of-truth `src/lib/on-device/prompt.ts`.
- **Inference location**: the user's own device. Session data never transmitted.
- Past-order signals, if added later, must send **categories only** (no order
  detail) — or be computed client-side.

## Consequences

- **Pro**: zero inference cost/latency on our infra; strong privacy; works offline
  once cached; small blast radius (flag + gate + worker, isolated under
  `src/lib/on-device/` + `src/components/on-device/`).
- **Con**: ~400MB model download (capable devices only, cached); WebGPU-only
  (excludes most phones — acceptable, silent); model quality is modest (270M) but
  the task is narrow and fine-tuned.
- **Ops**: model files are large binaries in `public/`. If repo bloat matters,
  move them to a CDN/S3 and point `env.localModelPath` at it (no code change
  beyond the base path).

## Open questions

- Serve model from CDN vs. `public/`? Start in `public/`; revisit if repo size hurts.
- Add past-order category signal (client-computed) once we see real usage.
- Telemetry: capability-gate verdict distribution (how many devices qualify) would
  guide whether to invest further — add an anonymous count later.
