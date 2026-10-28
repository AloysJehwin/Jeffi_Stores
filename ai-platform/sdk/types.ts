// Wire contract shared by the SDK (app side) and the gateway (server side).
// Kept identical to the app's previous ai-client.ts surface so the full swap is a
// signature-preserving change.

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
  /** Provider-native assistant content (e.g. Claude thinking + tool_use blocks), replayed verbatim
   *  when the next request goes to the same provider; ignored by any other provider. */
  providerState?: ProviderState
}

export interface ProviderState {
  provider: 'anthropic'
  content: unknown[]
}

export interface AiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** Text providers the gateway can route chat to ('razer' = the Ollama pool). */
export type TextProviderName = 'anthropic' | 'razer'

/** 'deep' = hardest reasoning (Opus on Anthropic; the agent model on Ollama). */
export type ModelHint = 'sql' | 'copy' | 'agent' | 'fast' | 'enrich' | 'email' | 'deep'

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: ModelHint
  forceProvider?: 'openai' | 'ollama' | 'anthropic'
  /** Allowed text providers in order; overrides the gateway default. forceProvider still wins. */
  providers?: TextProviderName[]
  tools?: AiToolDef[]
  /** Bypass the LLM cache (both KV and semantic) for this request. */
  noCache?: boolean
  /** Cache partition (the tenant id). Cached answers are never shared across namespaces. */
  cacheNamespace?: string
  /** The store's Anthropic workload identity (non-secret ids); without it Claude needs the dev key. */
  anthropicIdentity?: AnthropicIdentity
}

export interface AnthropicIdentity {
  workspaceId: string
  serviceAccountId: string
  federationRuleId: string
}

export interface AiToolCall {
  /** Provider tool-call id (Anthropic tool_use id); echo it back as tool_call_id. */
  id?: string
  name: string
  arguments: Record<string, unknown>
}

export interface TokenUsage {
  /** All input tokens, cached or not. */
  promptTokens: number
  completionTokens: number
  costInr: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Input tokens weighted to the uncached input price (cache reads/writes scaled); bill on this. */
  billedPromptTokens?: number
}

export type TextResponseProvider = 'openai' | 'ollama' | 'anthropic'

export interface AiChatResponse {
  content: string
  toolCalls?: AiToolCall[]
  provider: TextResponseProvider
  model: string
  latencyMs: number
  fallbackUsed: boolean
  /** Which cache tier served this, when any. */
  cache?: 'kv' | 'semantic' | null
  usage?: TokenUsage
  /** Echo on the assistant message of the next request (see AiChatMessage.providerState). */
  providerState?: ProviderState
  stopReason?: string
}

/** NDJSON frames from POST /v1/chat/stream, one JSON object per line. */
export type AiChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id?: string; name: string }
  | { type: 'done'; response: AiChatResponse }
  | { type: 'error'; error: string; status?: number }

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
  /** Allowed providers in order; overrides the gateway's AI_IMAGE_PROVIDERS. `provider` still wins. */
  providers?: ImageProviderName[]
  /** Image-to-image / edit when the provider supports it. */
  referenceImageUrl?: string
  seed?: number
  /** Cut the subject out to a transparent PNG (background-removal post-step on Replicate). */
  transparent?: boolean
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
  /** Set when `transparent` ran the cutout step; its cost is included in usage.costInr. */
  backgroundRemoval?: { provider: 'replicate'; model: string; costInr: number }
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
  /** Allowed providers in order; overrides the gateway's AI_VIDEO_PROVIDERS. `provider` still wins. */
  providers?: VideoProviderName[]
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

// ── Provider status (GET /v1/providers) ─────────────────────────────────────
export interface ProviderStatus<N extends string = string> {
  name: N
  /** Credentials/endpoint present (text: the Ollama pool answered its last probe). */
  configured: boolean
  /** anthropic: a static dev key serves stores without a workload identity. */
  keyFallback?: boolean
}

export interface ProvidersResponse {
  text: ProviderStatus<TextProviderName>[]
  image: ProviderStatus<ImageProviderName>[]
  video: ProviderStatus<VideoProviderName>[]
  /** The gateway's own default order per capability. */
  defaults: { text: TextProviderName[]; image: ImageProviderName[]; video: VideoProviderName[] }
}

export interface VisionRequest {
  /** Base64-encoded image (no data: prefix), or an array for multi-page. */
  images: string[]
  prompt: string
  model?: string
  cacheNamespace?: string
  anthropicIdentity?: AnthropicIdentity
}

export interface VisionResponse {
  ok: boolean
  text: string
  model: string
  provider?: 'anthropic' | 'paddleocr' | 'ollama'
  usage?: TokenUsage
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
