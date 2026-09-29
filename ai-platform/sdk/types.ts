// Wire contract shared by the SDK (app side) and the gateway (server side).
// Kept identical to the app's previous ai-client.ts surface so the full swap is a
// signature-preserving change.

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

export type ModelHint = 'sql' | 'copy' | 'agent' | 'fast' | 'enrich' | 'email'

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: ModelHint
  forceProvider?: 'openai' | 'ollama'
  tools?: AiToolDef[]
  /** Bypass the LLM cache (both KV and semantic) for this request. */
  noCache?: boolean
  /** Cache partition (the tenant id). Cached answers are never shared across namespaces. */
  cacheNamespace?: string
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
  /** Which cache tier served this, when any. */
  cache?: 'kv' | 'semantic' | null
}

export interface EmbedRequest {
  input: string | string[]
  model?: string
}

export interface EmbedResponse {
  embeddings: number[][]
  model: string
}

export interface VisionRequest {
  /** Base64-encoded image (no data: prefix), or an array for multi-page. */
  images: string[]
  prompt: string
  model?: string
}

export interface VisionResponse {
  ok: boolean
  text: string
  model: string
  pages?: number
  error?: string
  hint?: string
}

export class AiClientError extends Error {
  constructor(message: string, public readonly provider: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AiClientError'
  }
}
