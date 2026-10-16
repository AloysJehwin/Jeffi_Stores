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

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  costInr: number
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
  usage?: TokenUsage
}

export interface EmbedRequest {
  input: string | string[]
  model?: string
}

export interface EmbedResponse {
  embeddings: number[][]
  model: string
  usage?: TokenUsage
}

// ── Image generation ────────────────────────────────────────────────────────
export type ImageProviderName = 'razer' | 'google' | 'replicate'
export type ImageQuality = 'draft' | 'standard' | 'premium'

export interface ImageGenerateRequest {
  prompt: string
  negativePrompt?: string
  /** Default 1024, clamped 256..1536, snapped to a multiple of 64. */
  width?: number
  height?: number
  /** 1..4, default 1. */
  n?: number
  quality?: ImageQuality
  provider?: ImageProviderName
  /** Image-to-image / edit when the provider supports it. */
  referenceImageUrl?: string
  seed?: number
  /** Cache partition (tenant id); hits only ever come from the same namespace. */
  namespace?: string
}

export interface GeneratedImageRef {
  /** Short-lived gateway URL (/v1/files/<id>); the app persists to its own storage. */
  url: string
  width: number
  height: number
  mime: string
}

export interface ImageUsage {
  units: number
  unitType: 'image'
  costInr: number
}

export interface ImageGenerateResponse {
  images: GeneratedImageRef[]
  provider: ImageProviderName
  model: string
  usage: ImageUsage
  latencyMs: number
  cache?: 'kv' | null
}

// ── Video generation (async) ────────────────────────────────────────────────
export type VideoProviderName = 'google' | 'replicate'
export type VideoAspect = '9:16' | '16:9' | '1:1'

export interface VideoGenerateRequest {
  prompt: string
  imageUrl?: string
  /** 2..8, default 5. */
  durationSec?: number
  aspect?: VideoAspect
  provider?: VideoProviderName
  namespace?: string
}

export interface VideoStartResponse {
  jobId: string
  provider: VideoProviderName
  model: string
  estimatedCostInr: number
}

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface VideoJobResult {
  videoUrl: string
  durationSec: number
  width: number
  height: number
  mime: string
}

export interface VideoUsage {
  units: number
  unitType: 'video_second'
  costInr: number
}

export interface VideoJobResponse {
  status: VideoJobStatus
  result?: VideoJobResult
  usage?: VideoUsage
  provider?: VideoProviderName
  model?: string
  error?: string
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
