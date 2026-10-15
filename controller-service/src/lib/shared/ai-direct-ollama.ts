// Direct-to-Ollama path, used only when the ai-platform gateway is unreachable or 5xx.
// Mirrors ai-platform/gateway/src/config.ts (modelForHint) and providers/ollama.ts so a
// fallback answer matches what the gateway would have produced.
import type { AiChatRequest, AiChatResponse, AiToolCall, AiVisionResult } from './ai-client'

export function ollamaDirectUrl(): string {
  return (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '')
}

export function modelForHint(hint: AiChatRequest['modelHint']): string {
  const fast = process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_EMAIL_MODEL || 'gemma3:4b'
  switch (hint) {
    case 'sql': return process.env.OLLAMA_SQL_MODEL || 'gemma4:12b'
    case 'agent': return process.env.OLLAMA_AGENT_MODEL || 'qwen2.5:7b'
    case 'fast': return fast
    case 'email': return process.env.OLLAMA_EMAIL_MODEL || fast
    case 'enrich': return process.env.OLLAMA_ENRICH_MODEL || fast
    case 'copy':
    default: return process.env.OLLAMA_COPY_MODEL || 'gemma4:12b'
  }
}

const visionModel = () => process.env.OLLAMA_VISION_MODEL || 'gemma4:12b'
const embedModel = () => process.env.RAG_EMBED_MODEL || 'nomic-embed-text'

async function post(path: string, body: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${ollamaDirectUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function directChat(req: AiChatRequest, timeoutMs: number): Promise<AiChatResponse> {
  const start = Date.now()
  const model = modelForHint(req.modelHint)
  const data = await post('/api/chat', {
    model,
    messages: req.messages,
    tools: req.tools,
    stream: false,
    think: false,
    format: req.jsonMode ? 'json' : undefined,
    options: { temperature: req.temperature ?? 0.2, num_predict: req.maxTokens ?? 2000, num_ctx: 8192 },
  }, timeoutMs)
  const msg = data?.message ?? {}
  const base = { provider: 'ollama' as const, model, latencyMs: 0, fallbackUsed: true, cache: null }

  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const toolCalls: AiToolCall[] = msg.tool_calls.map((tc: any) => ({
      name: tc.function?.name ?? '',
      arguments: typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : (tc.function?.arguments ?? {}),
    }))
    return { ...base, content: '', toolCalls, latencyMs: Date.now() - start }
  }

  let content = msg.content
  if ((typeof content !== 'string' || content.trim() === '') && typeof msg.thinking === 'string') content = msg.thinking
  if (typeof content !== 'string') throw new Error('Ollama response missing message.content')
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trimStart()
  return { ...base, content, latencyMs: Date.now() - start }
}

export async function directEmbed(input: string | string[], model: string | undefined, timeoutMs: number): Promise<number[][]> {
  const m = model || embedModel()
  const out: number[][] = []
  for (const text of Array.isArray(input) ? input : [input]) {
    const data = await post('/api/embeddings', { model: m, prompt: text }, timeoutMs)
    if (!Array.isArray(data?.embedding)) throw new Error('No embedding returned')
    out.push(data.embedding)
  }
  return out
}

export async function directVision(images: string[], prompt: string, model: string | undefined, timeoutMs: number): Promise<AiVisionResult> {
  const m = model || visionModel()
  try {
    const data = await post('/api/chat', {
      model: m,
      stream: false,
      messages: [{ role: 'user', content: prompt, images }],
      options: { temperature: 0.1 },
    }, timeoutMs)
    const text = String(data?.message?.content || '').trim()
    return { ok: !!text, text, model: m, fallbackUsed: true }
  } catch (e) {
    return { ok: false, text: '', model: m, fallbackUsed: true, error: `Direct Ollama vision failed: ${(e as Error)?.message || e}` }
  }
}

/** Cheap reachability check (GET /api/tags). */
export async function directReachable(timeoutMs = 5_000): Promise<{ ok: boolean; error?: string }> {
  const base = ollamaDirectUrl()
  if (!base) return { ok: false, error: 'OLLAMA_BASE_URL not set' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal })
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    return { ok: false, error: err?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : err?.cause?.code || err?.message || String(e) }
  } finally {
    clearTimeout(t)
  }
}
