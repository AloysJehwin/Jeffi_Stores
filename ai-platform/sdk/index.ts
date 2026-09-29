import { loadConfig, type SdkConfig } from './config'
import { post, getHealth } from './transport'
import type {
  AiChatRequest, AiChatResponse,
  EmbedRequest, EmbedResponse,
  VisionRequest, VisionResponse,
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

/** Text embeddings (RAG, semantic cache). */
export async function embed(req: EmbedRequest): Promise<EmbedResponse> {
  return post<EmbedResponse>(cfg(), '/v1/embed', req)
}

/** Vision / OCR over one or more base64 images. */
export async function vision(req: VisionRequest): Promise<VisionResponse> {
  return post<VisionResponse>(cfg(), '/v1/vision', req)
}

/** Is the gateway reachable? (does not guarantee a model is loaded) */
export async function health(): Promise<boolean> {
  return getHealth(cfg())
}
