import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { AiChatRequest, AiChatResponse } from '../../../sdk/types'

// Exact-match completion cache in Redis. Key folds in everything that changes the
// output, so a hit is byte-identical to a fresh call. Cheapest tier, checked first.

export function cacheKey(req: AiChatRequest, model: string): string {
  const shape = {
    namespace: req.cacheNamespace || 'platform',
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.2,
    maxTokens: req.maxTokens ?? 2000,
    jsonMode: !!req.jsonMode,
  }
  return 'aicache:kv:' + createHash('sha256').update(JSON.stringify(shape)).digest('hex')
}

export async function kvGet(redis: Redis, key: string): Promise<Pick<AiChatResponse, 'content' | 'model'> | null> {
  const raw = await redis.get(key).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function kvSet(redis: Redis, key: string, value: { content: string; model: string }, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {})
}
