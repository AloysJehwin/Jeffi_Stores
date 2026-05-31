# ADR-0001: AI training pipeline (re-ranker / fine-tune)

- **Status**: Proposed
- **Date**: 2026-05-31
- **Decision deadline**: When `ai_feedback` accumulates ~500 explicit rows or ~5,000 implicit rows
- **Authors**: ops + AI/infra

## Context

PR #314 added an AI-assisted product search that:
1. Retrieves candidates via RAG over 15,458 product/variant embeddings on the Razer dev box
2. Hydrates with live data from prod RDS
3. Ranks via Llama 3.1 8B (Ollama) or gpt-4o-mini (fallback)
4. Logs every interaction to `ai_feedback` with both explicit (thumbs) and implicit (clicked / added_to_cart / purchased) signals

The feedback loop is **collecting data right now** but doing nothing with it yet. This ADR defines the next step: when do we use that data, and how.

## Goal

Improve top-5 recommendation precision (measured against a held-out test set) without:
- Adding latency to the customer-facing path
- Introducing hallucinations (recommendations for products that don't exist)
- Making the pipeline harder to operate

## What the data looks like

After ~30 days of moderate traffic we expect roughly:
- 1,500-3,000 `ai_queries` rows (10/day quota × 5-10 active users)
- 200-500 explicit thumbs (response rate ~10-15%)
- 800-2,500 implicit clicks
- 200-700 implicit add_to_cart
- 50-200 implicit purchased

Per `ai_feedback` row we have: `(ai_query_id, user_id, product_id, signal, comment, created_at)`.
Joined with `ai_queries` we also have: the original `query_text` and the array of `recommended_product_ids` that were shown.

This is enough to construct **labeled training pairs**:
```
(query_text, candidate_product_id, label)
```
where `label` is derived from the strongest signal observed within 24h:
- `purchased` → 1.0
- `added_to_cart` → 0.7
- `helpful` (explicit thumbs up) → 0.6
- `clicked` → 0.4
- shown but no engagement → 0.1
- `not_helpful` → -0.5
- `overall_not_helpful` → -0.3 (applies to whole result set)

## Three paths

### Path A — Cross-encoder re-ranker (recommended)

Add a third stage between RAG and the LLM ranker. Train a small bi/cross-encoder on the labeled pairs to score `(query, candidate)` directly.

```
query → RAG (top 50) → re-ranker (top 10) → LLM ranks (top 5) → response
```

| | |
|---|---|
| Model | `cross-encoder/ms-marco-MiniLM-L6-v2` fine-tuned on our pairs |
| Training time | ~2 hours on RTX 4080 |
| Inference time | ~50ms for 50 candidates |
| Code complexity | Low. New `src/lib/reranker.ts` + a training script |
| When to trigger | 500 explicit rows OR 2,000 implicit rows |
| Improvement expected | top-5 precision +15-25% (typical for re-rankers on domain data) |

**Why this is the recommended path**: small data goes a long way, runs on existing hardware, doesn't replace any existing component, easy to A/B test and roll back.

### Path B — LoRA fine-tune of Llama 3.1 8B

Fine-tune the ranker model itself on `(query, full catalog excerpt, ideal recommendations)` triplets.

| | |
|---|---|
| Model | Llama 3.1 8B + LoRA adapter, rank=16 |
| Training time | ~6-12 hours on RTX 4080 |
| Inference time | unchanged |
| Code complexity | Medium. New `scripts/train-lora.py` + adapter loading in Ollama |
| When to trigger | 2,000+ explicit rows |
| Improvement expected | uncertain. LLMs aren't where the bottleneck is; the bottleneck is retrieval. |

**Why we'd consider this**: voice/tone consistency, catching domain quirks (industrial Indian hardware vernacular), making a smaller model match `gpt-4o-mini` quality.

**Why we'd skip it**: most of the gain we're chasing comes from retrieval (Path A) not generation. Fine-tuning before retrieval is solid is wasted effort.

### Path C — Better prompts (always do this)

Use the feedback data to find common failure patterns and improve the system prompt.

| | |
|---|---|
| Effort | 1 day to analyze + iterate |
| Code change | None or trivial |
| When to trigger | 100 rows |
| Improvement expected | 5-15% depending on current prompt quality |

**Always run this in parallel with A or B.** It's the cheapest improvement and often the most surprising.

## Decision matrix

| Stage | Action | Trigger |
|---|---|---|
| 0 (now) | Collect data via PR #314 | merged |
| 1 | Path C — prompt improvement | 100 rows |
| 2 | Path A — train re-ranker | 500 explicit OR 2,000 implicit |
| 3 | Re-evaluate against held-out test set | 1 week post-deploy of re-ranker |
| 4 | Path B — fine-tune | only if (2) didn't close the gap to OpenAI |

## Implementation plan for Path A (the realistic one)

### Step 1 — Export training pairs (1 day)

`scripts/export-training-pairs.mjs`:
- Pull `ai_feedback` joined with `ai_queries`
- Per `ai_query_id`, collect all `recommended_product_ids` and the strongest signal observed for each within 24h of the query
- Output JSONL:
  ```jsonl
  {"query": "wrench for tight space", "product_id": "abc...", "label": 1.0}
  {"query": "wrench for tight space", "product_id": "def...", "label": 0.1}
  ```
- Held-out 10% as test set (deterministic split by `ai_query_id` hash)

### Step 2 — Train (1 day on RTX 4080)

`scripts/train-reranker.py`:
- Sentence-transformers cross-encoder, `ms-marco-MiniLM-L6-v2` base
- Pairwise hinge loss with the label deltas
- Train 3-5 epochs, eval each epoch on the held-out set with NDCG@5
- Save adapter to `/opt/jeffi-rag/reranker/`

### Step 3 — Wire into the pipeline (1 day)

`src/lib/reranker.ts`:
- Calls a small Python service on the Razer (`uvicorn` + the trained model) at `100.110.153.68:8001/rerank`
- Or: re-export to ONNX and run via `onnxruntime-node` in-process (faster, fewer moving parts — explore second)
- Inserts between `searchCandidatesViaRag` (returns 50) and `callRanker` (gets 10)
- Behind a `RERANKER_ENABLED=true` env var so we can A/B test in prod

### Step 4 — A/B test (2 weeks)

Half the traffic goes through the re-ranker, half doesn't. Compare:
- top-1 click-through rate
- conversion rate (purchased / queried)
- average `helpful` thumbs ratio

If re-ranker wins by ≥10% on at least 2 metrics, ship to 100%. If it loses, debug or roll back.

## Operational notes

- All training runs on the Razer's RTX 4080. No cloud GPU spend.
- The re-ranker model is small (~80MB ONNX). Lives on the Razer alongside Ollama.
- Training data is exported from RDS to the Razer for training, never the other way around.
- If we ever fine-tune a per-customer model or use any PII, **revisit** this ADR — current scope is product/query pairs only, no PII in training data.

## Open questions

- Should we add `disliked_at` / `corrected_to_product_id` to `ai_feedback` so admins can manually correct AI mistakes and feed those into training? Probably yes, after Path A ships.
- Do we want to cap how much feedback any single user can contribute to avoid skew? Defer until we see actual distribution.
- Cold start when products are added: new products have no feedback, so the re-ranker shouldn't penalize them. Implement: if a candidate has zero feedback rows ever, use the LLM-only ranker for that candidate (skip re-ranker score).

## Decision

**Defer until we have at least 500 explicit feedback rows** (estimated ~30 days post-merge). Then implement Path A as described. Path B only if Path A's gain is insufficient.

This ADR is the contract for future-us. When the trigger hits, open ADR-0003 with concrete metrics, training run logs, A/B test plan.
