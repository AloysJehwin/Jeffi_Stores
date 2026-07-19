# Plan: On-device Gemma 3 270M checkout recap summary

> Working plan for review (not an ADR yet — ADR-0002 gets written during Step 2).
> Ship a **cart-recap summary** on the checkout review page, generated **entirely in
> the user's browser** (WebGPU, transformers.js + ONNX) by a **fine-tuned Gemma 3 270M**.
> No cloud inference — the model runs on the customer's device, so their session data
> never leaves it (a strong privacy story vs. ADR-0001's PII caveat).

**Status:** Step 1 (capability gate) DONE + committed (`012a8836`). This plan covers
Steps 2–6. **No GPU work runs until the user explicitly approves the fine-tune step.**

## Decisions locked (from user)
- **Summary purpose:** cart recap / reassurance (not cross-sell, not intent).
- **Input signals:** cart contents + this-session browsing + past orders + search/filters used.
- **Fine-tune up front** (synthetic dataset from the catalog); runtime **transformers.js + ONNX**, WebGPU.
- **Strict capability gate**, **silent UX** (summary appears only on capable devices), progressive enhancement — never blocks checkout.

## Already built (Step 1)
- `src/lib/on-device/capability.ts` — `detectOnDeviceCapability()`: WebGPU adapter + `deviceMemory>=4GB` + GPU limit checks; model-cache + storage probes. Verified CAPABLE on Apple Silicon (16GB, 4096MB buffers).
- `src/components/on-device/OnDeviceCapabilityDebug.tsx` + `/dev/on-device` page.

## Conventions to honor (from ADR-0001)
- Training on the Razer RTX 4080 only; export to **ONNX**; scripts in `scripts/`.
- **No PII in training data** — session signals are aggregated/anonymized (product names, categories, counts — never names/addresses/emails). Inference is on-device, so raw session data never leaves the browser. Write **ADR-0002** documenting this pipeline + privacy posture.

---

## Step 2 — Synthetic training dataset — `scripts/gen-onboarding-dataset.mjs`
Generate `(session-signals JSON → ideal recap summary)` pairs from the **local** catalog (port 5432, never live).
- Sample real products/categories/brands; synthesize plausible sessions: N cart items (with qty), a few "viewed" products in related categories, occasional "past order" categories, occasional search terms.
- Render an **ideal recap** from curated templates in the target voice (2–3 sentences, warm, concrete: names categories/brands, notes completeness, reassures). Vary templates so the model generalizes, not memorizes.
- Output JSONL `{"prompt","completion"}`; deterministic 90/10 train/val split; target ~1–3k examples.
- **User reviews a sample** for tone before training.
- Define the **prompt serialization format** here — shared verbatim by training AND the browser runtime (single source of truth in `src/lib/on-device/prompt.ts`).

## Step 3 — Fine-tune on Razer 4080 — `scripts/train-gemma-onboarding.py` (GPU, needs approval)
- LoRA fine-tune `google/gemma-3-270m` on the JSONL using the existing `~/sd-cover/.venv` (+ `peft`, `trl`, `datasets`). Rank ~16, few epochs; eval on val split.
- **VRAM caveat:** ~3.6GB free last check — free VRAM (stop Ollama/SD residents) first; 270M+LoRA should fit <4GB but confirm.
- Merge LoRA → full weights; keep run logs; artifacts stay on the Razer.

## Step 4 — Export to ONNX + quantize — `scripts/export-gemma-onnx.py`
- Merged model → ONNX via `optimum` → **quantize q4/int8** (target ~150–300MB).
- Produce transformers.js layout: `onnx/model_quantized.onnx` + `tokenizer.json` + `config.json`.
- **TOP RISK — verify Gemma-3-270M is supported** by installed `optimum` + transformers.js at build time (arch support moves fast). If not exportable/loadable, fall back to nearest supported small Gemma and note it. Validate BEFORE Step 5.
- Host weights under `public/models/onboarding/` (or CDN); lazy-fetch + cache in Cache Storage (`MODEL_CACHE_NAME` from Step 1).

## Step 5 — Browser runtime — `src/lib/on-device/runtime.ts`
- Add `@huggingface/transformers`. Load with `device:'webgpu'`, `dtype:'q4'` from our hosted path; browser-cached.
- API: `loadSummarizer()` (idempotent, lazy) + `generateRecap(signals)→string` via the shared serializer. Run in a **Web Worker** so checkout never janks.
- Gated behind `detectOnDeviceCapability()` → capable only; silent first load, background download, summary appears when ready.

## Step 6 — Signal collection + checkout UI
- **Session tracker** `src/lib/on-device/session-signals.ts`: sessionStorage store of recently-viewed product names/categories + search terms; tiny hooks on product/search pages (no backend). Cart via `useCart()`; past-order **categories only** (anonymized) fetched once or skipped if logged out.
- **`buildSignals()`** merges all four sources → serialized prompt (aggregated, no PII).
- **`<CheckoutRecapSummary/>`** on `src/app/checkout/review/page.tsx`: mounts client-side, runs the gate, renders a small "Your order at a glance" card that streams the on-device summary on capable devices; renders nothing otherwise or on error. Non-blocking.

## Critical files
- **New:** `scripts/gen-onboarding-dataset.mjs`, `scripts/train-gemma-onboarding.py`, `scripts/export-gemma-onnx.py`, `src/lib/on-device/prompt.ts`, `src/lib/on-device/runtime.ts`, `src/lib/on-device/session-signals.ts`, `src/components/on-device/CheckoutRecapSummary.tsx`, `public/models/onboarding/*`, `docs/adr/0002-on-device-summary.md`.
- **Edit:** `src/app/checkout/review/page.tsx`, product/search pages (tracking hooks), `package.json`.
- **Reuse:** `src/lib/on-device/capability.ts`, `useCart()`, `useAuth()`, pricing helpers.

## Verification
- Dataset: user sign-off on sample summaries.
- Export: generate one summary in a throwaway harness before wiring UI.
- Runtime: extend `/dev/on-device` to do a live generation (dev only).
- Checkout: capable device streams the recap non-blocking; incapable shows nothing; tsc + full vitest + lint + graphify each step.

## Risks
1. **transformers.js/optimum support for Gemma-3-270M ONNX** — validate in Step 4 before UI.
2. Model download size vs. UX — keep quantized small; lazy + cached; silent.
3. Razer VRAM for training — free it first.
4. Each step commits to `feature-business` separately; GPU steps only after explicit approval.
