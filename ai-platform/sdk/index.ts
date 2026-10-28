import { loadConfig, type SdkConfig } from './config'
import { post, get, getHealth, postNdjson } from './transport'
import { AiClientError } from './types'
import type {
  AiChatRequest, AiChatResponse, AiChatStreamEvent,
  EmbedRequest, EmbedResponse,
  VisionRequest, VisionResponse,
  ImageGenerateRequest, ImageGenerateResponse,
  VideoGenerateRequest, VideoStartResponse, VideoJobResponse,
  ProvidersResponse,
} from './types'

export * from './types'
export { loadConfig, type SdkConfig } from './config'

let cached: SdkConfig | null = null
function cfg(): SdkConfig {
  return (cached ??= loadConfig())
}

/** Override config once at boot (tests, or an explicit gateway URL). */
export function configure(overrides: Partial<SdkConfig>): void {
  cached = loadConfig(overrides)
}

/**
 * Chat/completion. Same signature as the app's previous aiChat(): callers still
 * `await` a single response. Durability (queue + retry) and caching happen inside
 * the gateway, invisible to the caller.
 */
export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  return post<AiChatResponse>(cfg(), '/v1/chat', req)
}

/**
 * Streaming chat: calls onEvent for each text delta / tool-call start, resolves with the final
 * response (same shape as aiChat). Abort with `signal`.
 */
export async function aiChatStream(
  req: AiChatRequest,
  opts: { onEvent?: (e: AiChatStreamEvent) => void; signal?: AbortSignal } = {},
): Promise<AiChatResponse> {
  for await (const e of postNdjson<AiChatStreamEvent>(cfg(), '/v1/chat/stream', req, opts.signal)) {
    if (e.type === 'done') return e.response
    if (e.type === 'error') throw new AiClientError(`AI gateway stream: ${e.error}`, 'gateway')
    opts.onEvent?.(e)
  }
  throw new AiClientError('AI gateway stream ended without a result', 'gateway')
}

/** Text embeddings (RAG, semantic cache). */
export async function embed(req: EmbedRequest): Promise<EmbedResponse> {
  return post<EmbedResponse>(cfg(), '/v1/embed', req)
}

/** Vision / OCR over one or more base64 images. */
export async function vision(req: VisionRequest): Promise<VisionResponse> {
  return post<VisionResponse>(cfg(), '/v1/vision', req)
}

/** Text-to-image / image-edit. Returns short-lived gateway URLs the app persists itself. */
export async function generateImage(req: ImageGenerateRequest): Promise<ImageGenerateResponse> {
  const r = await post<ImageGenerateResponse>(cfg(), '/v1/images/generate', req)
  return { ...r, images: r.images.map(i => ({ ...i, url: absolute(i.url) })) }
}

/** Start a text-to-video (or image-to-video) job; poll with videoJob(jobId). */
export async function generateVideo(req: VideoGenerateRequest): Promise<VideoStartResponse> {
  return post<VideoStartResponse>(cfg(), '/v1/video/generate', req)
}

/** State of a video job started with generateVideo(). */
export async function videoJob(jobId: string): Promise<VideoJobResponse> {
  const r = await get<VideoJobResponse>(cfg(), `/v1/jobs/${encodeURIComponent(jobId)}`)
  return r.result ? { ...r, result: { ...r.result, videoUrl: absolute(r.result.videoUrl) } } : r
}

/** Which providers the gateway can route to, and its default order per capability. */
export async function providers(): Promise<ProvidersResponse> {
  return get<ProvidersResponse>(cfg(), '/v1/providers')
}

// The gateway returns /v1/files/<id> unless AI_PUBLIC_URL is set; resolve against the gateway URL.
function absolute(url: string): string {
  return url.startsWith('/') ? `${cfg().gatewayUrl}${url}` : url
}

/** Is the gateway reachable? (does not guarantee a model is loaded) */
export async function health(): Promise<boolean> {
  return getHealth(cfg())
}
