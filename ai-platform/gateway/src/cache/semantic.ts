import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { ollamaEmbed } from '../providers/ollama'
import type { AiChatRequest } from '../../../sdk/types'

// Semantic completion cache backed by pgvector (ai_cache table). Embeds the last user
// turn and finds the nearest stored prompt inside one partition: the tenant namespace plus
// an exact hash of everything around that turn (system prompt, history, model, output mode).
// A near-match can only substitute the user's wording, never another store's instructions.
// Only used for cacheable, non-agent hints (see policy.ts).

export interface SemanticKey {
  namespace: string
  modelHint: string
  contextHash: string
  prompt: string
}

export function semanticKey(req: AiChatRequest, model: string): SemanticKey | null {
  let idx = -1
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') { idx = i; break }
  }
  if (idx < 0) return null
  const prompt = req.messages[idx].content
  if (!prompt.trim()) return null
  const context = {
    model,
    jsonMode: !!req.jsonMode,
    maxTokens: req.maxTokens ?? 2000,
    before: req.messages.slice(0, idx),
    after: req.messages.slice(idx + 1),
  }
  return {
    namespace: (req.cacheNamespace || 'platform').slice(0, 64),
    modelHint: req.modelHint ?? 'copy',
    contextHash: createHash('sha256').update(JSON.stringify(context)).digest('hex'),
    prompt,
  }
}

export async function semanticGet(pool: Pool, key: SemanticKey, minSimilarity: number): Promise<string | null> {
  const [embedding] = await ollamaEmbed([key.prompt]).catch(() => [null as unknown as number[]])
  if (!embedding) return null
  const vec = `[${embedding.join(',')}]`
  // Cosine distance operator <=>; similarity = 1 - distance.
  const res = await pool.query(
    `SELECT id, response, 1 - (embedding <=> $1::vector) AS similarity
       FROM ai_cache
      WHERE namespace = $2 AND model_hint = $3 AND context_hash = $4
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [vec, key.namespace, key.modelHint, key.contextHash],
  ).catch(() => null)
  const row = res?.rows[0]
  if (!row || Number(row.similarity) < minSimilarity) return null
  pool.query(`UPDATE ai_cache SET hits = hits + 1, last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {})
  return row.response as string
}

export async function semanticSet(pool: Pool, key: SemanticKey, response: string): Promise<void> {
  if (!response.trim()) return
  const [embedding] = await ollamaEmbed([key.prompt]).catch(() => [null as unknown as number[]])
  if (!embedding) return
  const vec = `[${embedding.join(',')}]`
  await pool.query(
    `INSERT INTO ai_cache (namespace, model_hint, context_hash, prompt, embedding, response)
     VALUES ($1, $2, $3, $4, $5::vector, $6)`,
    [key.namespace, key.modelHint, key.contextHash, key.prompt, vec, response],
  ).catch(() => {})
}
