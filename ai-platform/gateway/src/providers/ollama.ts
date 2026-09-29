import { CONFIG, modelForHint } from '../config'
import { AiClientError, type AiChatRequest, type AiToolCall } from '../../../sdk/types'

// Ollama provider — ported verbatim from the app's ai-client.ts callOllama() + rag.ts embed(),
// so behaviour (tool calls, <think> stripping, json format, num_ctx) is unchanged. This is the
// only place that speaks Ollama's wire protocol now.

export async function ollamaReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), CONFIG.ollamaHealthTimeoutMs)
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/tags`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export async function ollamaChat(req: AiChatRequest): Promise<{ content: string; toolCalls?: AiToolCall[]; model: string }> {
  const model = modelForHint(req.modelHint)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CONFIG.ollamaRequestTimeoutMs)
  try {
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/chat`, {
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
    const data = (await res.json()) as any
    const msg = data?.message ?? {}

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
    if ((typeof content !== 'string' || content.trim() === '') && typeof msg.thinking === 'string') {
      content = msg.thinking
    }
    if (typeof content !== 'string') throw new AiClientError('Ollama response missing message.content', 'ollama')
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trimStart()
    return { content, model }
  } finally {
    clearTimeout(t)
  }
}

export async function ollamaEmbed(input: string[], model?: string): Promise<number[][]> {
  const m = model || CONFIG.embedModel
  const out: number[][] = []
  for (const text of input) {
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, prompt: text }),
    })
    if (!res.ok) throw new AiClientError(`Ollama embeddings HTTP ${res.status}`, 'ollama')
    const data = (await res.json()) as { embedding?: number[] }
    if (!Array.isArray(data.embedding)) throw new AiClientError('No embedding returned', 'ollama')
    out.push(data.embedding)
  }
  return out
}
