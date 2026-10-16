// Routing + validation for /v1/images/generate, /v1/video/generate, /v1/jobs/:id.
// Kept thin so tests can wire mock providers in.

import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import type {
  GeneratedImageRef, ImageGenerateRequest, ImageGenerateResponse,
  ImageProviderName, ImageQuality,
  VideoAspect, VideoGenerateRequest, VideoJobResponse, VideoProviderName, VideoStartResponse,
} from '../../sdk/types'
import type { FileStore } from './files'
import { costFor } from './pricing'
import { ProviderError, type ImageGenInput, type MediaProvider, type VideoGenInput } from './providers/types'
import { createVideoJobStore, resultFrom, toResponse, type VideoJobStore } from './video-jobs'

export const IMAGE_PROVIDER_ORDER: ImageProviderName[] = ['razer', 'google', 'replicate']
export const VIDEO_PROVIDER_ORDER: VideoProviderName[] = ['google', 'replicate']

export class ValidationError extends Error { readonly status = 400 }
export class UpstreamError extends Error {
  constructor(message: string, readonly tried: { provider: string; error: string }[]) { super(message) }
  readonly status = 502
}
export class NotConfiguredError extends Error { readonly status = 503 }

interface ParsedImageReq extends ImageGenInput { provider?: ImageProviderName; namespace: string; cacheKey: string }
interface ParsedVideoReq extends VideoGenInput { provider?: VideoProviderName; namespace: string }

const IMAGE_PROVIDER_SET = new Set<ImageProviderName>(['razer', 'google', 'replicate'])
const VIDEO_PROVIDER_SET = new Set<VideoProviderName>(['google', 'replicate'])
const QUALITIES = new Set<ImageQuality>(['draft', 'standard', 'premium'])
const VIDEO_ASPECTS = new Set<VideoAspect>(['9:16', '16:9', '1:1'])

export function parseImageProviders(raw: string | undefined): ImageProviderName[] {
  return parseProviders(raw, IMAGE_PROVIDER_ORDER, IMAGE_PROVIDER_SET)
}
export function parseVideoProviders(raw: string | undefined): VideoProviderName[] {
  return parseProviders(raw, VIDEO_PROVIDER_ORDER, VIDEO_PROVIDER_SET)
}
function parseProviders<T extends string>(raw: string | undefined, def: T[], allow: Set<T>): T[] {
  if (!raw) return def
  const seen = new Set<T>()
  const out: T[] = []
  for (const p of raw.split(',').map(x => x.trim()).filter(Boolean)) {
    if (allow.has(p as T) && !seen.has(p as T)) { seen.add(p as T); out.push(p as T) }
  }
  return out.length ? out : def
}

/** Image routing order: pinned provider first (when given), else configured order with quality bias. */
export function imageRoute(req: ImageGenerateRequest, configured: ImageProviderName[]): ImageProviderName[] {
  if (req.provider) return [req.provider, ...configured.filter(p => p !== req.provider)]
  const biased = [...configured]
  if (req.quality === 'premium') biased.sort((a, b) => (a === 'google' ? -1 : b === 'google' ? 1 : 0))
  else if (req.quality === 'draft') biased.sort((a, b) => (a === 'razer' ? -1 : b === 'razer' ? 1 : 0))
  return biased
}

export function videoRoute(req: VideoGenerateRequest, configured: VideoProviderName[]): VideoProviderName[] {
  if (req.provider) return [req.provider, ...configured.filter(p => p !== req.provider)]
  return configured
}

export function parseImageRequest(raw: unknown): ParsedImageReq {
  const r = (raw ?? {}) as Partial<ImageGenerateRequest>
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
  if (!prompt) throw new ValidationError('prompt is required')
  const width = clampDim(r.width ?? 1024)
  const height = clampDim(r.height ?? 1024)
  const n = clamp(Math.floor(Number(r.n ?? 1)), 1, 4)
  const quality = (QUALITIES.has(r.quality as ImageQuality) ? r.quality : 'standard') as ImageQuality
  const provider = r.provider && IMAGE_PROVIDER_SET.has(r.provider as ImageProviderName) ? (r.provider as ImageProviderName) : undefined
  const namespace = typeof r.namespace === 'string' && r.namespace ? r.namespace : 'platform'
  const negativePrompt = typeof r.negativePrompt === 'string' && r.negativePrompt ? r.negativePrompt : undefined
  const referenceImageUrl = typeof r.referenceImageUrl === 'string' && r.referenceImageUrl ? r.referenceImageUrl : undefined
  const seed = typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.floor(r.seed) : undefined
  const cacheKey = imageCacheKey({ prompt, negativePrompt, width, height, n, quality, provider, referenceImageUrl, namespace })
  return { prompt, negativePrompt, width, height, n, quality, provider, referenceImageUrl, seed, namespace, cacheKey }
}

export function parseVideoRequest(raw: unknown): ParsedVideoReq {
  const r = (raw ?? {}) as Partial<VideoGenerateRequest>
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
  if (!prompt) throw new ValidationError('prompt is required')
  const durationSec = clamp(Math.round(Number(r.durationSec ?? 5)), 2, 8)
  const aspect = (VIDEO_ASPECTS.has(r.aspect as VideoAspect) ? r.aspect : '16:9') as VideoAspect
  const provider = r.provider && VIDEO_PROVIDER_SET.has(r.provider as VideoProviderName) ? (r.provider as VideoProviderName) : undefined
  const namespace = typeof r.namespace === 'string' && r.namespace ? r.namespace : 'platform'
  const imageUrl = typeof r.imageUrl === 'string' && r.imageUrl ? r.imageUrl : undefined
  return { prompt, imageUrl, durationSec, aspect, provider, namespace }
}

/** Stable hash of the provider-agnostic request (no seed), partitioned by namespace. */
export function imageCacheKey(req: {
  prompt: string; negativePrompt?: string; width: number; height: number
  n: number; quality: ImageQuality; provider?: ImageProviderName; referenceImageUrl?: string; namespace: string
}): string {
  const shape = {
    namespace: req.namespace,
    prompt: req.prompt,
    negativePrompt: req.negativePrompt || '',
    width: req.width, height: req.height, n: req.n, quality: req.quality,
    provider: req.provider || '*',
    ref: req.referenceImageUrl || '',
  }
  return 'ai:image:kv:' + createHash('sha256').update(JSON.stringify(shape)).digest('hex')
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function clampDim(v: number): number {
  const n = clamp(Math.round(Number(v) || 0), 256, 1536)
  return Math.round(n / 64) * 64 || 256
}

export interface ImageRouterDeps {
  providers: Record<ImageProviderName, MediaProvider>
  order: ImageProviderName[]
  files: FileStore
  redis?: Redis | null
  fileBaseUrl?: string
  ttlSec?: number
}

export async function handleImageGenerate(req: ImageGenerateRequest, deps: ImageRouterDeps): Promise<ImageGenerateResponse> {
  const p = parseImageRequest(req)
  const start = Date.now()
  const route = imageRoute(req, deps.order).filter(name => deps.providers[name]?.configured())
  if (!route.length) throw new NotConfiguredError('no image provider configured')

  const cacheable = typeof p.seed !== 'number'
  if (cacheable && deps.redis) {
    const hit = await readImageCache(deps.redis, p.cacheKey)
    if (hit) return { ...hit, latencyMs: Date.now() - start, cache: 'kv' }
  }

  const tried: { provider: string; error: string }[] = []
  for (const name of route) {
    const provider = deps.providers[name]
    try {
      if (!provider.generateImage) throw new ProviderError(name, 'no image support')
      const out = await provider.generateImage(p)
      const refs = await Promise.all(out.images.map(img => storeImage(deps, img.bytes, img.mime, img.width, img.height)))
      const costInr = costFor(name, out.model, { image: refs.length })
      const response: ImageGenerateResponse = {
        images: refs,
        provider: name,
        model: out.model,
        usage: { units: refs.length, unitType: 'image', costInr },
        latencyMs: Date.now() - start,
        cache: null,
      }
      if (cacheable && deps.redis) await writeImageCache(deps.redis, p.cacheKey, response, deps.ttlSec ?? 3600)
      return response
    } catch (err) {
      tried.push({ provider: name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  throw new UpstreamError('image generation failed on all providers', tried)
}

async function storeImage(deps: ImageRouterDeps, bytes: Buffer, mime: string, width: number, height: number): Promise<GeneratedImageRef> {
  const id = await deps.files.put({ bytes, mime }, deps.ttlSec)
  return { url: `${deps.fileBaseUrl || ''}/v1/files/${id}`, width, height, mime }
}

export async function readImageCache(redis: Redis, key: string): Promise<Omit<ImageGenerateResponse, 'latencyMs' | 'cache'> | null> {
  const raw = await redis.get(key).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

async function writeImageCache(redis: Redis, key: string, value: ImageGenerateResponse, ttlSec: number): Promise<void> {
  const { latencyMs, cache, ...rest } = value
  await redis.set(key, JSON.stringify(rest), 'EX', ttlSec).catch(() => undefined)
}

// ── Video ────────────────────────────────────────────────────────────────────
export interface VideoRouterDeps {
  providers: Partial<Record<VideoProviderName, MediaProvider>>
  order: VideoProviderName[]
  jobs: VideoJobStore
  files: FileStore
  fileBaseUrl?: string
}

export async function handleVideoStart(req: VideoGenerateRequest, deps: VideoRouterDeps): Promise<VideoStartResponse> {
  const p = parseVideoRequest(req)
  const route = videoRoute(req, deps.order).filter(name => deps.providers[name]?.configured())
  if (!route.length) throw new NotConfiguredError('no video provider configured')
  const tried: { provider: string; error: string }[] = []
  for (const name of route) {
    const provider = deps.providers[name]!
    try {
      if (!provider.startVideo) throw new ProviderError(name, 'no video support')
      const start = await provider.startVideo(p)
      const state = await deps.jobs.create({
        provider: name,
        model: start.model,
        opId: start.opId,
        durationSec: start.durationSec,
        aspect: start.aspect ?? p.aspect,
        namespace: p.namespace,
        prompt: p.prompt,
        imageUrl: p.imageUrl,
      })
      const estimatedCostInr = costFor(name, start.model, { video_second: start.durationSec })
      return { jobId: state.jobId, provider: name, model: start.model, estimatedCostInr }
    } catch (err) {
      tried.push({ provider: name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  throw new UpstreamError('video job failed to start on all providers', tried)
}

export async function readVideoJob(id: string, deps: VideoRouterDeps): Promise<VideoJobResponse> {
  const state = await deps.jobs.get(id)
  if (!state) throw new ValidationError('unknown job')
  return toResponse(state, deps.fileBaseUrl)
}

/** Advance one open job: polls the provider, stores bytes, finalises cost. */
export async function advanceVideoJob(id: string, deps: VideoRouterDeps): Promise<VideoJobResponse> {
  const state = await deps.jobs.get(id)
  if (!state) throw new ValidationError('unknown job')
  if (state.status === 'done' || state.status === 'failed') return toResponse(state, deps.fileBaseUrl)
  const provider = deps.providers[state.provider]
  if (!provider?.pollVideo) {
    const failed = await deps.jobs.update(id, { status: 'failed', error: `provider ${state.provider} not available` })
    return toResponse(failed ?? state, deps.fileBaseUrl)
  }
  try {
    if (state.status === 'queued') await deps.jobs.update(id, { status: 'running' })
    const poll = await provider.pollVideo(state.opId, state.model)
    if (poll.error) {
      const failed = await deps.jobs.update(id, { status: 'failed', error: poll.error })
      return toResponse(failed ?? state, deps.fileBaseUrl)
    }
    if (!poll.done || !poll.result) return toResponse((await deps.jobs.get(id)) ?? state, deps.fileBaseUrl)
    const fileId = await deps.files.put({ bytes: poll.result.bytes, mime: poll.result.mime })
    const result = resultFrom(poll.result, fileId, state.durationSec, state.aspect)!
    const costInr = costFor(state.provider, state.model, { video_second: result.durationSec })
    const done = await deps.jobs.update(id, {
      status: 'done', result,
      usage: { units: result.durationSec, unitType: 'video_second', costInr },
    })
    return toResponse(done ?? state, deps.fileBaseUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const failed = await deps.jobs.update(id, { status: 'failed', error: msg })
    return toResponse(failed ?? state, deps.fileBaseUrl)
  }
}

export { createVideoJobStore }
