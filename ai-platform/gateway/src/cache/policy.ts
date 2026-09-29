import type { AiChatRequest, ModelHint } from '../../../sdk/types'

// What may be cached, and how. Correctness-sensitive hints (tool-calling agents, NL->SQL)
// bypass the SEMANTIC cache entirely — a near-match answer there could be subtly wrong or
// call the wrong tool. Deterministic copy generation is safe to reuse.

export interface CachePolicy {
  kv: boolean            // exact-match KV reuse
  semantic: boolean      // approximate semantic reuse
  ttlSeconds: number     // KV/semantic entry lifetime
  similarity: number     // min cosine for a semantic hit
}

const DEFAULT: CachePolicy = { kv: true, semantic: false, ttlSeconds: 3600, similarity: 0.97 }

const BY_HINT: Partial<Record<ModelHint, CachePolicy>> = {
  copy:    { kv: true, semantic: true, ttlSeconds: 86_400, similarity: 0.97 },
  email:   { kv: true, semantic: true, ttlSeconds: 86_400, similarity: 0.97 },
  fast:    { kv: true, semantic: true, ttlSeconds: 43_200, similarity: 0.98 },
  enrich:  { kv: true, semantic: true, ttlSeconds: 86_400, similarity: 0.97 },
  // agent + sql: KV only (exact repeats are safe; approximate reuse is not).
  agent:   { kv: true, semantic: false, ttlSeconds: 600, similarity: 1 },
  sql:     { kv: true, semantic: false, ttlSeconds: 600, similarity: 1 },
}

export function policyFor(req: AiChatRequest): CachePolicy {
  if (req.noCache) return { kv: false, semantic: false, ttlSeconds: 0, similarity: 1 }
  // Tool calls are never cached: the answer is a side-effecting action, not a reusable string.
  if (req.tools && req.tools.length > 0) return { kv: false, semantic: false, ttlSeconds: 0, similarity: 1 }
  return BY_HINT[req.modelHint ?? 'copy'] ?? DEFAULT
}
