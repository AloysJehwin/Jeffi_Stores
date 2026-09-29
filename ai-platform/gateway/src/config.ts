// Gateway config — this is where all host/model/provider knowledge now lives (moved
// out of the Next.js app). On the Razer cluster these come from a k8s ConfigMap/Secret;
// in cloud, the same keys point at managed endpoints. The app never sees any of this.

export const CONFIG = {
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/$/, ''),
  paddleOcrUrl: (process.env.PADDLE_OCR_URL || 'http://paddleocr:8866').replace(/\/$/, ''),
  ollamaHealthTimeoutMs: Number(process.env.OLLAMA_HEALTH_TIMEOUT_MS) || 2_000,
  ollamaRequestTimeoutMs: Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS) || 120_000,

  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',

  // Semantic cache backing store (pgvector) — the ai_cache table. Reuses the same
  // Postgres that holds embeddings.
  pgUrl: process.env.AI_CACHE_PG_URL || process.env.RAG_PG_URL || '',
  embedModel: process.env.RAG_EMBED_MODEL || 'nomic-embed-text',

  port: Number(process.env.PORT) || 8080,

  // OpenAI escape hatch (only when a request forces it) — parity with the old client.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
}

import type { ModelHint } from '../../sdk/types'

const AGENT = process.env.OLLAMA_AGENT_MODEL || 'qwen2.5:7b'
const FAST = process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_EMAIL_MODEL || 'gemma3:4b'

/** Resolve a modelHint to a concrete Ollama model name (was inline in ai-client.ts). */
export function modelForHint(hint: ModelHint | undefined): string {
  switch (hint) {
    case 'sql': return process.env.OLLAMA_SQL_MODEL || 'gemma4:12b'
    case 'agent': return AGENT
    case 'fast': return FAST
    case 'email': return process.env.OLLAMA_EMAIL_MODEL || FAST
    case 'enrich': return process.env.OLLAMA_ENRICH_MODEL || FAST
    case 'copy':
    default: return process.env.OLLAMA_COPY_MODEL || 'gemma4:12b'
  }
}

export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'gemma4:12b'
