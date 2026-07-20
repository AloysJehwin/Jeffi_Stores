# Plan: Enable the on-device checkout summary in LIVE (CDN + CI build-arg)

## Why the simple approach failed
Live runs the app as a **Docker image** (`ghcr.io/aloysjehwin/jeffi_stores:latest`, built by `.github/workflows/ci.yml`), behind nginx. Therefore:
- **`NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY` is compiled in at `next build`** (in CI), not read at runtime → editing `.env.production` on the host does nothing (verified; reverted).
- **`public/` is baked into the image** (`COPY --from=builder /app/public ./public`), and the app container does **not** bind-mount `public/` → host uploads aren't served (verified; cleaned up).
- The model weights (437 MB) + ORT wasm (74 MB) are **gitignored**, so CI's build context won't contain them.

Net: enabling live = **a CI/image change**, done right.

## Decision: host model on CDN, load by URL, flag via CI build-arg
Keep the giant binaries **out of git and out of the Docker image** (image stays lean). Host them on **S3/CloudFront** (the project already uses `dm9rri2wgl1e.cloudfront.net` + `*.amazonaws.com`, both already in the CSP `img-src`/`connect-src`). The browser fetches the model from the CDN; the flag is compiled in via a CI build-arg like the existing Razorpay/GST flags.

## Steps

### 1. Host the model assets on the existing S3/CloudFront
Upload to a stable prefix, e.g. `s3://<bucket>/models/onboarding/`:
- `onnx/model_quantized.onnx`, `config.json`, `generation_config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`
- `ort/` (the 22 `.mjs` + 4 `.wasm`)
Served via the existing CloudFront distribution. Immutable (versioned path, e.g. `/models/onboarding/v1/`) so caching is safe.

### 2. Make the model base URL configurable (code)
- New env `NEXT_PUBLIC_ONDEVICE_MODEL_BASE` (default empty → same-origin `/models/` for local dev, as today).
- In `summary.worker.ts`: `remoteHost` = the CDN origin (from the env) when set, else current origin; `remotePathTemplate` unchanged. Same for `env.backends.onnx.wasm.wasmPaths` → CDN `/ort/` when set.
- No behavior change locally (env unset → current same-origin path).

### 3. CSP — allow the CDN
`connect-src` already includes `https://dm9rri2wgl1e.cloudfront.net` and `https://*.amazonaws.com`. Confirm the chosen host is covered; if a new distribution is used, add it to `connect-src` (and `worker-src`/`script-src` if the `.mjs` load from CDN — likely add the CDN origin to `script-src`).

### 4. CI build-args (mirror the Razorpay flag exactly)
- **Dockerfile:** add `ARG NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY` + `ENV ...` and `ARG/ENV NEXT_PUBLIC_ONDEVICE_MODEL_BASE` in the builder stage (next to the existing `NEXT_PUBLIC_ENABLE_RAZORPAY`).
- **ci.yml:** add both to the `build-args:` block from GitHub **secrets/vars** (`NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY`, `NEXT_PUBLIC_ONDEVICE_MODEL_BASE`).
- Add the two GitHub Actions secrets/vars (repo settings) — flag `true`, base = the CloudFront URL.

### 5. Ship + verify
- Merge → CI builds the image with the flag on + CDN base → deploy pulls `:latest` → containers restart.
- Verify on live: checkout review on a capable device streams the recap; Network shows model fetched from the **CDN** (not origin, not 404); incapable devices show nothing; no console errors.

## Not doing
- No 500 MB in git or in the Docker image.
- No host-file hacks (they don't affect a build-time flag / baked public).

## Risks / notes
- CSP for the CDN `.mjs`/`.wasm` — confirm `script-src`/`connect-src` cover it before flipping on.
- Model is versioned in the CDN path so a future retrain doesn't serve stale cached weights.
- Everything stays behind the flag: if the CDN base is wrong, worst case the gate still renders nothing (non-blocking).

## Approval needed
This touches the **Dockerfile + ci.yml + CSP** and requires **S3/CloudFront upload + 2 GitHub secrets** (which I can't set — that's yours). Approve and I'll make the code/CI/Docker/CSP changes on `feature-business`; you upload to S3 + add the secrets; then a merge builds & deploys it.
