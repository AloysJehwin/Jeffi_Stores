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

/** Text providers the gateway can route chat to ('razer' = the Ollama pool, 'azure' = an Azure OpenAI chat deployment). */
export type TextProviderName = 'anthropic' | 'razer' | 'azure'

/** Provider -> model id for one capability; each id must be on that provider's list in GET /v1/providers, else 400. */
export type ModelChoice = Partial<Record<string, string>>

/** A selectable model in GET /v1/providers. */
export interface ModelOption {
  id: string
  /** Human-friendly, e.g. 'Claude Sonnet 5.5'. */
  label: string
  /** What the provider uses when the request names no model. */
  default?: boolean
}

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
  /** Model per text provider (replaces the modelHint's model on that provider). */
  models?: ModelChoice
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

export type TextResponseProvider = 'openai' | 'ollama' | 'anthropic' | 'azure'

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

/** One selected provider, never an order: vectors from two models can't be mixed. */
export type EmbedProviderName = 'razer' | 'azure'

export interface EmbedRequest {
  input: string | string[]
  /** The provider's model: an Ollama embeddings model (razer) or an embeddings deployment (azure, always 768
   *  dimensions); must be on the provider's embed list in GET /v1/providers. Default: the provider's default. */
  model?: string
  /** Default: the gateway's AI_EMBED_PROVIDER (razer). No fallback to the other provider. */
  provider?: EmbedProviderName
}

export interface EmbedResponse {
  embeddings: number[][]
  /** Vector-space id to store with the vectors: the Ollama model (razer), or 'text-embedding-3-small@768' for azure's
   *  default deployment and '<deployment>@768' for another. */
  model: string
  provider: EmbedProviderName
  dimensions: number
  usage?: TokenUsage
}

// ── Image generation ────────────────────────────────────────────────────────
export type ImageProviderName = 'razer' | 'google' | 'replicate' | 'azure'
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
  /** Model per image provider (replaces the quality's model on that provider). */
  models?: ModelChoice
  /** Image-to-image / edit when the provider supports it. */
  referenceImageUrl?: string
  seed?: number
  /** Cut the subject out to a transparent PNG (background-removal post-step on Replicate). */
  transparent?: boolean
  /** Cache partition (tenant id); hits only ever come from the same namespace. */
  namespace?: string
}

export interface GeneratedImageRef {
  /** Short-lived gateway URL (/v1/files/<id>; fetch it with fileHeaders()); the app persists to its own storage. */
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

// ── Stock photos (POST /v1/images/stock) ────────────────────────────────────
export type StockProviderName = 'pexels' | 'pixabay'
export type StockOrientation = 'landscape' | 'portrait' | 'square'

export interface StockSearchRequest {
  /** A short keyword search ("indian sweet shop"), not an image-model prompt. */
  query: string
  orientation?: StockOrientation
  /** Hits narrower than this are dropped (after the 24 h cache). */
  minWidth?: number
  /** 1..30, default 15. */
  perPage?: number
  /** Allowed providers in order; overrides AI_STOCK_PROVIDERS. */
  providers?: StockProviderName[]
}

/** One hit, the same shape for every provider. `url` is the file to copy (never hotlink it). */
export interface StockImage {
  provider: StockProviderName
  id: string
  url: string
  width: number
  height: number
  alt: string
  photographer: string
  photographerUrl: string | null
  pageUrl: string
}

/** Empty `results` when no provider is keyed or none found anything; `tried` names the ones that failed. */
export interface StockSearchResponse {
  results: StockImage[]
  provider: StockProviderName | null
  cache: 'kv' | null
  tried?: { provider: string; error: string }[]
}

// ── Video generation (async) ────────────────────────────────────────────────
export type VideoProviderName = 'google' | 'replicate' | 'azure'
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
  models?: ModelChoice
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

// ── Audio (POST /v1/audio/transcribe, /v1/audio/speak) ──────────────────────
/** Speech to text (AI_STT_PROVIDERS) and text to speech (AI_TTS_PROVIDERS) are ordered separately. */
export type SttProviderName = 'sarvam' | 'azure'
export type TtsProviderName = 'sarvam' | 'azure'
export type AudioFormat = 'mp3' | 'wav' | 'ogg'

export interface AudioUsage {
  units: number
  unitType: 'audio_minute' | 'tts_1k_chars'
  costInr: number
}

export interface TranscribeRequest {
  /** Bare base64 (no data: prefix), at most 25 MB of audio. */
  audioBase64: string
  mimeType: string
  /** BCP-47, e.g. hi-IN. Omit to let the model detect it. */
  language?: string
  /** Speech-to-text providers in order; overrides AI_STT_PROVIDERS. */
  providers?: SttProviderName[]
  models?: ModelChoice
}

export interface TranscribeResponse {
  text: string
  /** The requested language, else the detected one, else 'und'. */
  language: string
  durationSeconds: number
  provider: SttProviderName
  model: string
  usage?: AudioUsage
}

export interface SpeakRequest {
  /** At most 5,000 characters. */
  text: string
  /** BCP-47, e.g. hi-IN; picks the default neural voice. */
  language: string
  voice?: string
  /** Default mp3. */
  format?: AudioFormat
  /** Text-to-speech providers in order; overrides AI_TTS_PROVIDERS. */
  providers?: TtsProviderName[]
  models?: ModelChoice
}

export interface SpeakResponse {
  audioBase64: string
  mimeType: string
  characters: number
  provider: TtsProviderName
  model: string
  usage?: AudioUsage
}

// ── Provider status (GET /v1/providers) ─────────────────────────────────────
export interface ProviderStatus<N extends string = string> {
  name: N
  /** Credentials/endpoint present (text and embed razer: the Ollama pool answered its last probe). */
  configured: boolean
  /** anthropic: a static dev key serves stores without a workload identity. */
  keyFallback?: boolean
  /** razer: false while its backend's circuit breaker is open (routing skips it). */
  healthy?: boolean
  /** The models a request may pick for this provider and capability (`models` / embed `model`). */
  models: ModelOption[]
}

/** The LLM service's backends: Ollama (text, vision, embed), SD (image), PaddleOCR (ocr). */
export type RazerBackendName = 'ollama' | 'sd' | 'paddleocr'

export interface RazerBackendHealth {
  configured: boolean
  /** The last probe answered. */
  ok: boolean
  /** Circuit breaker open: routing skips razer for this backend's capabilities until a probe recovers. */
  open: boolean
  reason?: string
  checkedAt: number | null
}

export type RazerHealth = Record<RazerBackendName, RazerBackendHealth>

export interface ProvidersResponse {
  text: ProviderStatus<TextProviderName>[]
  image: ProviderStatus<ImageProviderName>[]
  video: ProviderStatus<VideoProviderName>[]
  stt: ProviderStatus<SttProviderName>[]
  tts: ProviderStatus<TtsProviderName>[]
  /** One provider serves embeddings (defaults.embed); the other is never a fallback. */
  embed: ProviderStatus<EmbedProviderName>[]
  /** configured = the sidecar answered its last probe with the model loaded. */
  ocr: ProviderStatus<OcrProviderName>[]
  /** configured = its API key is set. */
  stock?: ProviderStatus<StockProviderName>[]
  razer?: RazerHealth
  /** The gateway's own default order per capability (embed: the single provider). */
  defaults: {
    text: TextProviderName[]; image: ImageProviderName[]; video: VideoProviderName[]
    stt: SttProviderName[]; tts: TtsProviderName[]; embed: EmbedProviderName; stock?: StockProviderName[]
  }
}

export interface VisionRequest {
  /** Base64-encoded image (no data: prefix), or an array for multi-page. */
  images: string[]
  prompt: string
  model?: string
  cacheNamespace?: string
  anthropicIdentity?: AnthropicIdentity
  /** The store's text order (Site Controls): cloud providers before razer read images in order; OCR/Ollama only when razer is in it. */
  providers?: TextProviderName[]
  /** The store's text models: anthropic and azure read images with theirs; razer keeps `model` / OLLAMA_VISION_MODEL. */
  models?: ModelChoice
}

export interface VisionResponse {
  ok: boolean
  text: string
  model: string
  provider?: 'anthropic' | 'azure' | 'paddleocr' | 'ollama'
  usage?: TokenUsage
  pages?: number
  error?: string
  hint?: string
}

// ── OCR (POST /v1/ocr): PaddleOCR only, never a model, so a document reads the same every time ──
export type OcrProviderName = 'paddleocr'
export type OcrMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'

export interface OcrRequest {
  /** Base64 file (no data: prefix), at most 12 MB of base64. */
  data: string
  /** Default: sniffed from the bytes, else image/png. A PDF is read up to 10 pages. */
  mime_type?: OcrMimeType
}

export interface OcrLine {
  text: string
  /** Recognition confidence 0..1, 3 decimals. */
  score: number
}

/** 200. A document with nothing legible is still ok: text '' and lines []. */
export interface OcrResponse {
  ok: true
  /** The lines joined with \n, pages in order. */
  text: string
  lines: OcrLine[]
  /** Mean line score; null when nothing was read. */
  meanScore: number | null
  pages: number
  model: string
  provider: OcrProviderName
}

/** 400: bad request (missing, oversized or non-base64 data, unsupported type). 503: PaddleOCR down or failed. */
export interface OcrErrorResponse {
  ok: false
  error: string
}

export class AiClientError extends Error {
  constructor(message: string, public readonly provider: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AiClientError'
  }
}
