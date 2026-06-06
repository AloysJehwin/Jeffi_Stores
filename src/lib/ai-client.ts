export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: 'sql' | 'copy' | 'agent'
}

export interface AiChatResponse {
  content: string
  provider: 'openai' | 'ollama'
  model: string
  latencyMs: number
  fallbackUsed: boolean
}

export class AiClientError extends Error {
  constructor(message: string, public readonly provider: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AiClientError'
  }
}

const PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase() as 'openai' | 'ollama'
const FALLBACK_ENABLED = process.env.OLLAMA_FALLBACK_TO_OPENAI === 'true'
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_AGENT_MODEL = process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'
const OLLAMA_SQL_MODEL = process.env.OLLAMA_SQL_MODEL || OLLAMA_AGENT_MODEL
const OLLAMA_COPY_MODEL = process.env.OLLAMA_COPY_MODEL || OLLAMA_AGENT_MODEL
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OLLAMA_HEALTH_TIMEOUT_MS = 2000
const OLLAMA_REQUEST_TIMEOUT_MS = 120_000

async function isOllamaReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), OLLAMA_HEALTH_TIMEOUT_MS)
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

async function callOllama(req: AiChatRequest): Promise<{ content: string; model: string }> {
  const model = req.modelHint === 'sql'
    ? OLLAMA_SQL_MODEL
    : req.modelHint === 'agent'
      ? OLLAMA_AGENT_MODEL
      : OLLAMA_COPY_MODEL
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), OLLAMA_REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: req.messages,
        stream: false,
        format: req.jsonMode ? 'json' : undefined,
        options: {
          temperature: req.temperature ?? 0.2,
          num_predict: req.maxTokens ?? 2000,
          num_ctx: 8192,
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new AiClientError(`Ollama HTTP ${res.status}: ${body}`, 'ollama')
    }
    const data = await res.json()
    let content = data?.message?.content
    if (typeof content !== 'string') throw new AiClientError('Ollama response missing message.content', 'ollama')
    // Strip <think>...</think> reasoning blocks emitted by Qwen3 and similar models
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trimStart()
    return { content, model }
  } finally {
    clearTimeout(t)
  }
}

async function callOpenAi(req: AiChatRequest): Promise<{ content: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new AiClientError('OPENAI_API_KEY not configured', 'openai')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2000,
      response_format: req.jsonMode ? { type: 'json_object' } : undefined,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new AiClientError(body?.error?.message || `OpenAI HTTP ${res.status}`, 'openai')
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new AiClientError('OpenAI response missing choices[0].message.content', 'openai')
  return { content, model: OPENAI_MODEL }
}

export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  const start = Date.now()

  if (PROVIDER === 'ollama') {
    const reachable = await isOllamaReachable()
    if (reachable) {
      try {
        const r = await callOllama(req)
        return { content: r.content, provider: 'ollama', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false }
      } catch (err) {
        if (!FALLBACK_ENABLED) throw err
      }
    }
    if (FALLBACK_ENABLED) {
      const r = await callOpenAi(req)
      return { content: r.content, provider: 'openai', model: r.model, latencyMs: Date.now() - start, fallbackUsed: true }
    }
    throw new AiClientError('Ollama unreachable and fallback disabled', 'ollama')
  }

  const r = await callOpenAi(req)
  return { content: r.content, provider: 'openai', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false }
}

export function getAiProvider(): 'openai' | 'ollama' {
  return PROVIDER
}
