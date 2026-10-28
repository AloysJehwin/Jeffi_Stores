import { CONFIG, modelForHint } from '../config'
import { AiClientError, type AiChatRequest, type AiToolCall } from '../../../sdk/types'
import { OllamaPool } from './ollama-pool'

// Ollama provider — ported verbatim from the app's ai-client.ts callOllama() + rag.ts embed(),
// so behaviour (tool calls, <think> stripping, json format, num_ctx) is unchanged. This is the
// only place that speaks Ollama's wire protocol now.

export const ollamaPool = new OllamaPool(CONFIG.ollamaBaseUrls, {
  probeTimeoutMs: CONFIG.ollamaHealthTimeoutMs,
  probeIntervalMs: CONFIG.ollamaProbeIntervalMs,
})

export interface OllamaChatResult { content: string; toolCalls?: AiToolCall[]; model: string; promptTokens: number; completionTokens: number }

export function ollamaChat(req: AiChatRequest): Promise<OllamaChatResult> {
  return ollamaPool.withOllama(base => chatAt(base, req))
}

async function chatAt(base: string, req: AiChatRequest): Promise<OllamaChatResult> {
  const model = modelForHint(req.modelHint)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CONFIG.ollamaRequestTimeoutMs)
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: req.messages.map(({ providerState: _s, ...m }) => m),
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
    const promptTokens = Number(data?.prompt_eval_count) || 0
    const completionTokens = Number(data?.eval_count) || 0

    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const toolCalls: AiToolCall[] = msg.tool_calls.map((tc: any) => ({
        name: tc.function?.name ?? '',
        arguments: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? {}),
      }))
      return { content: '', toolCalls, model, promptTokens, completionTokens }
    }

    let content = msg.content
    if ((typeof content !== 'string' || content.trim() === '') && typeof msg.thinking === 'string') {
      content = msg.thinking
    }
    if (typeof content !== 'string') throw new AiClientError('Ollama response missing message.content', 'ollama')
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trimStart()
    return { content, model, promptTokens, completionTokens }
  } finally {
    clearTimeout(t)
  }
}

export async function ollamaEmbed(input: string[], model?: string): Promise<{ embeddings: number[][]; promptTokens: number }> {
  const m = model || CONFIG.embedModel
  const out: number[][] = []
  let promptTokens = 0
  for (const text of input) {
    const r = await ollamaPool.withOllama(base => embedAt(base, text, m))
    out.push(r.embedding)
    promptTokens += r.promptTokens
  }
  return { embeddings: out, promptTokens }
}

async function embedAt(base: string, text: string, model: string): Promise<{ embedding: number[]; promptTokens: number }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CONFIG.ollamaRequestTimeoutMs)
  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ model, prompt: text }),
    })
    if (!res.ok) throw new AiClientError(`Ollama embeddings HTTP ${res.status}`, 'ollama')
    const data = (await res.json()) as { embedding?: number[]; prompt_eval_count?: number }
    if (!Array.isArray(data.embedding)) throw new AiClientError('No embedding returned', 'ollama')
    // /api/embeddings omits counts; estimate ~4 chars per token.
    return { embedding: data.embedding, promptTokens: Number(data.prompt_eval_count) || estimateTokens(text) }
  } finally {
    clearTimeout(t)
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4)
}
