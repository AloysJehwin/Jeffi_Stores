// App-side AI client. Model host/selection now lives behind the ai-platform gateway
// (see /ai-platform); this file is a thin, signature-preserving HTTP client to it, so the
// 11 AI consumers are unchanged. Durability (queue/retry) and LLM caching are the gateway's job.

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
}

export interface AiToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: 'sql' | 'copy' | 'agent' | 'fast' | 'enrich' | 'email'
  forceProvider?: 'openai' | 'ollama'
  tools?: AiToolDef[]
  noCache?: boolean
  /** Cache partition. Defaults to the current tenant; background jobs must pass it explicitly. */
  cacheNamespace?: string
}

export interface AiToolCall { name: string; arguments: Record<string, unknown> }

export interface AiChatResponse {
  content: string
  toolCalls?: AiToolCall[]
  provider: 'openai' | 'ollama'
  model: string
  latencyMs: number
  fallbackUsed: boolean
  cache?: 'kv' | 'semantic' | null
}

export class AiClientError extends Error {
  constructor(message: string, public readonly provider: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AiClientError'
  }
}

const GATEWAY_URL = (process.env.AI_GATEWAY_URL || 'http://100.82.208.8:8080').replace(/\/$/, '')
const GATEWAY_TIMEOUT_MS = Number(process.env.AI_GATEWAY_TIMEOUT_MS) || 130_000

export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  const cacheNamespace = req.cacheNamespace ?? await (async () => {
    try {
      const { resolveTenantId } = await import('@/lib/tenant-context')
      return (await resolveTenantId()) ?? 'platform'
    } catch {
      return 'platform'
    }
  })()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ ...req, cacheNamespace }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new AiClientError(`AI gateway HTTP ${res.status}: ${body}`, 'gateway')
    }
    return (await res.json()) as AiChatResponse
  } catch (err) {
    if (err instanceof AiClientError) throw err
    throw new AiClientError(err instanceof Error ? err.message : 'AI gateway request failed', 'gateway', err)
  } finally {
    clearTimeout(t)
  }
}

export function getAiProvider(): 'openai' | 'ollama' {
  return (process.env.AI_PROVIDER || 'ollama').toLowerCase() as 'openai' | 'ollama'
}

/** Embeddings via the gateway (used by RAG). Returns one vector per input. */
export async function aiEmbed(input: string | string[], model?: string): Promise<number[][]> {
  const res = await fetch(`${GATEWAY_URL}/v1/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model }),
  })
  if (!res.ok) throw new AiClientError(`AI gateway embed HTTP ${res.status}`, 'gateway')
  const data = await res.json()
  return data.embeddings as number[][]
}

export interface AiVisionResult { ok: boolean; text: string; model: string; pages?: number; error?: string; hint?: string }

/** Vision/OCR via the gateway. `images` are base64 (no data: prefix). */
export async function aiVision(images: string[], prompt: string, model?: string): Promise<AiVisionResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ images, prompt, model }),
    })
    if (!res.ok) return { ok: false, text: '', model: model || '', error: `AI gateway vision HTTP ${res.status}` }
    return (await res.json()) as AiVisionResult
  } catch (err) {
    return { ok: false, text: '', model: model || '', error: err instanceof Error ? err.message : 'vision request failed' }
  } finally {
    clearTimeout(t)
  }
}
