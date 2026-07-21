export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
}

export interface AiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: 'sql' | 'copy' | 'agent' | 'fast'
  forceProvider?: 'openai' | 'ollama'
  tools?: AiToolDef[]
}

export interface AiToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface AiChatResponse {
  content: string
  toolCalls?: AiToolCall[]
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

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_HEALTH_TIMEOUT_MS = 2000
// Per-request Ollama timeout. Kept modest so a hung/unreachable Ollama (e.g. the
// Razer laptop asleep) fails fast and the OpenAI fallback can trigger within the
// web request budget instead of hanging the whole request. Override via env.
const OLLAMA_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS) || 20_000

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

async function callOllama(req: AiChatRequest): Promise<{ content: string; toolCalls?: AiToolCall[]; model: string }> {
  const agentModel = process.env.OLLAMA_AGENT_MODEL || 'glm4'
  const model = req.modelHint === 'sql'
    ? (process.env.OLLAMA_SQL_MODEL || agentModel)
    : req.modelHint === 'agent'
      ? agentModel
      : (process.env.OLLAMA_COPY_MODEL || agentModel)
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
        tools: req.tools,
        stream: false,
        think: false,
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
    const msg = data?.message ?? {}

    // Native tool calls (Ollama tools API)
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const toolCalls: AiToolCall[] = msg.tool_calls.map((tc: any) => ({
        name: tc.function?.name ?? '',
        arguments: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? {}),
      }))
      return { content: '', toolCalls, model }
    }

    let content = msg.content
    // Qwen3 extended-thinking mode returns content in a separate 'thinking' field with empty content
    if ((typeof content !== 'string' || content.trim() === '') && typeof msg.thinking === 'string') {
      content = msg.thinking
    }
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
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: openaiModel,
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
  return { content, model: openaiModel }
}

export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  const start = Date.now()
  const provider = (req.forceProvider ?? process.env.AI_PROVIDER ?? 'openai').toLowerCase() as 'openai' | 'ollama'
  const fallbackEnabled = process.env.OLLAMA_FALLBACK_TO_OPENAI === 'true'

  if (provider === 'ollama') {
    const reachable = await isOllamaReachable()
    if (reachable) {
      try {
        const r = await callOllama(req)
        return { content: r.content, toolCalls: r.toolCalls, provider: 'ollama', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false }
      } catch (err) {
        if (!fallbackEnabled) throw err
      }
    }
    if (fallbackEnabled) {
      const r = await callOpenAi(req)
      return { content: r.content, provider: 'openai', model: r.model, latencyMs: Date.now() - start, fallbackUsed: true }
    }
    throw new AiClientError('Ollama unreachable and fallback disabled', 'ollama')
  }

  const r = await callOpenAi(req)
  return { content: r.content, provider: 'openai', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false }
}

export function getAiProvider(): 'openai' | 'ollama' {
  return (process.env.AI_PROVIDER || 'openai').toLowerCase() as 'openai' | 'ollama'
}
