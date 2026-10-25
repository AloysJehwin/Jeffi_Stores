// App media client: images and short video through the ai-platform gateway, charged through
// lib/ai/billing (preauthorize before, settle with the gateway's usage after) and persisted
// to the store's S3 bucket (gateway URLs are temporary). Contract: docs/plans/AI_MEDIA_PLATFORM_PLAN.md.
import { getAiRouting, getProviderPolicy } from '@/lib/providers/policy'
import { preauthorize, settle, AiWalletError } from './billing'
import { aiGatewayUrl } from '@/lib/shared/ai-client'
import { uploadGalleryImage, putObjectBuffer, getS3Url, currentBucket } from '@/lib/shared/s3'
import { query, queryOne } from '@/lib/shared/db'
import { AI_VIDEO_ASPECTS, AI_VIDEO_DURATIONS, type AiVideoAspect } from './media-features'
import { padToAspect, extForMime } from './reshape-image'

export { AiWalletError }

export type AiProvider = 'razer' | 'google' | 'replicate'
export type AiQuality = 'draft' | 'standard' | 'premium'
export type { AiVideoAspect }

interface GatewayImage {
  url: string
  width: number
  height: number
  mime: string
}

interface GatewayImageResponse {
  images: GatewayImage[]
  provider: AiProvider
  model: string
  usage: { units: number; unitType: 'image'; costInr: number }
  latencyMs: number
  cache?: 'kv' | null
}

interface GatewayVideoStart {
  jobId: string
  provider: 'google' | 'replicate'
  model: string
  estimatedCostInr: number
}

interface GatewayJob {
  status: 'queued' | 'running' | 'done' | 'failed'
  result?: { videoUrl: string; durationSec: number; width: number; height: number; mime: string }
  usage?: { units: number; unitType: 'video_second'; costInr: number }
  error?: string
}

export interface GeneratedImage {
  /** S3 URL. */
  url: string
  width: number
  height: number
  thumbnailUrl?: string
  blurhash?: string | null
  /** gallery_images id (always set when the gallery insert succeeds). */
  galleryId?: string
  /** product_images id when `attachToProductId` was set. */
  productImageId?: string
}

export interface GenerateImageOpts {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  n?: number
  quality?: AiQuality
  provider?: AiProvider
  referenceImageUrl?: string
  seed?: number
  feature: string
  ref?: string
  actor?: string | null
  /** @deprecated gallery insert is now unconditional; kept for client compat. */
  saveToGallery?: boolean
  /** Also add each image to this product's images (Google Ads assets are product_images rows). */
  attachToProductId?: string
  /** Pre-resolved tenant id; routes thread it so persistImage never has to re-resolve. */
  tenantId?: string | null
}

export interface GenerateImageResult {
  images: GeneratedImage[]
  usageId: string
  priceInr: number
  provider: AiProvider
  model: string
}

export interface GenerateVideoOpts {
  prompt: string
  imageUrl?: string
  durationSec?: number
  aspect?: AiVideoAspect
  provider?: 'google' | 'replicate'
  feature: string
  ref?: string
  actor?: string | null
}

export interface GenerateVideoResult {
  jobId: string
  usageId: string
  estimatedPriceInr: number
  provider: string
  model: string
}

export interface VideoJobResult {
  status: GatewayJob['status']
  /** S3 URL once done. */
  videoUrl?: string
  durationSec?: number
  /** Final charge once settled. */
  priceInr?: number
  /** gallery_videos id once the finished video has been written to the tenant gallery. */
  galleryVideoId?: string
  /** The reference image the video started from, recorded as the gallery poster. */
  posterUrl?: string | null
  error?: string
}

export class AiMediaError extends Error {
  constructor(
    message: string,
    public readonly status = 502
  ) {
    super(message)
    this.name = 'AiMediaError'
  }
}

const TIMEOUT_MS = Number(process.env.AI_MEDIA_TIMEOUT_MS) || 180_000
const FETCH_TIMEOUT_MS = 60_000

async function gatewayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${aiGatewayUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: ctrl.signal,
    })
  } catch (err) {
    clearTimeout(t)
    throw new AiMediaError(err instanceof Error ? `AI gateway unreachable: ${err.message}` : 'AI gateway unreachable', 503)
  }
  try {
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let body: { error?: string; tried?: { provider: string; error: string }[] } = {}
      try {
        body = JSON.parse(text)
      } catch {}
      throw gatewayError(res.status, body, text)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

function gatewayError(status: number, body: { error?: string; tried?: { provider: string; error: string }[] }, text: string): AiMediaError {
  if (status === 503) return new AiMediaError('AI media generation is not set up yet: no provider is configured. Contact support.', 503)
  if (status === 502 && body.tried?.length) {
    const detail = body.tried.map(t => `${t.provider}: ${t.error}`.slice(0, 160)).join('; ')
    return new AiMediaError(`Every AI provider failed, please try again (${detail})`, 502)
  }
  const msg = body.error || text.slice(0, 300)
  // 4xx is the caller's problem (bad prompt, policy); 5xx is ours.
  return new AiMediaError(status < 500 ? msg || 'The AI gateway rejected the request' : `AI gateway error ${status}${msg ? `: ${msg}` : ''}`, status < 500 ? 400 : 502)
}

async function namespace(): Promise<string> {
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return (await resolveTenantId()) ?? 'platform'
  } catch {
    return 'platform'
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
  if (m) return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  // Gateway file URLs are relative (/v1/files/<id>) unless AI_PUBLIC_URL is set on the gateway.
  const abs = /^https?:\/\//i.test(url) ? url : new URL(url, `${aiGatewayUrl().replace(/\/+$/, '')}/`).toString()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(abs, { signal: ctrl.signal })
    if (!res.ok) throw new AiMediaError(`Failed to fetch generated media (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(t)
  }
}

async function persistImage(img: GatewayImage, opts: GenerateImageOpts, idx: number, model: string): Promise<GeneratedImage> {
  const bytes = await fetchBytes(img.url)
  const up = await uploadGalleryImage(bytes, `ai-${opts.feature}-${Date.now()}-${idx}.png`)
  const out: GeneratedImage = {
    url: up.url,
    width: up.width || img.width,
    height: up.height || img.height,
    thumbnailUrl: up.thumbnailUrl,
    blurhash: up.blurhash,
  }
  // Always land the generation in the tenant gallery with provenance; a gallery write failure
  // must not fail the generation (the caller already has the asset URL).
  try {
    const tenantId = opts.tenantId ?? (await resolveTenantIdSafe())
    const row = await queryOne<{ id: string }>(
      `INSERT INTO gallery_images (image_url, thumbnail_url, s3_key, s3_thumbnail_key, s3_bucket, file_name, file_size, mime_type, width, height, blurhash, custom_name, tenant_id, source, prompt_text, model_name, media_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'image/png', $8, $9, $10, $11, $12, 'ai', $13, $14, 'image') RETURNING id`,
      [up.url, up.thumbnailUrl, up.s3Key, up.s3ThumbnailKey, await currentBucket(), up.fileName, up.fileSize, up.width, up.height, up.blurhash, `AI: ${opts.prompt.slice(0, 80)}`, tenantId, opts.prompt, model]
    )
    if (row) out.galleryId = row.id
  } catch (err) {
    console.warn(`[ai-media] gallery_images insert failed: ${(err as Error).message}`)
  }
  if (opts.attachToProductId) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, file_size, mime_type, width, height, blurhash, alt_text, display_order, is_primary)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'image/png', $9, $10, $11, $12, COALESCE(MAX(display_order), -1) + 1, false
       FROM product_images WHERE product_id = $1 RETURNING id`,
      [opts.attachToProductId, up.url, up.thumbnailUrl, await currentBucket(), up.s3Key, up.s3ThumbnailKey, up.fileName, up.fileSize, up.width, up.height, up.blurhash, opts.prompt.slice(0, 200)]
    )
    if (row) out.productImageId = row.id
  }
  return out
}

/** Dynamic resolveTenantId that never throws — mirrors namespace() so edge-safe. */
async function resolveTenantIdSafe(): Promise<string | null> {
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return await resolveTenantId()
  } catch {
    return null
  }
}

// preauthorize runs before routing is known ('auto'); record the provider that served the call so
// settle prices it from the right price-list row.
async function finalPrice(usageId: string, fallback: number): Promise<number> {
  const row = await queryOne<{ price_inr: string | number }>(`SELECT price_inr FROM ai_usage WHERE id = $1`, [usageId]).catch(() => null)
  return row ? Number(row.price_inr) : fallback
}

async function recordProvider(usageId: string, provider: string, model: string): Promise<void> {
  if (!usageId) return
  await query(`UPDATE ai_usage SET provider = $2, model = $3 WHERE id = $1`, [usageId, provider, model]).catch(() => {})
}

export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  const n = Math.min(4, Math.max(1, opts.n ?? 1))
  const { usageId, priceInr } = await preauthorize({
    feature: opts.feature,
    capability: 'image',
    provider: opts.provider ?? 'auto',
    model: 'auto',
    estimateUnits: [{ type: 'image', qty: n }],
    ref: opts.ref,
    actor: opts.actor ?? null,
  })
  const started = Date.now()
  const policy = await getProviderPolicy().catch(() => null)
  let gw: GatewayImageResponse
  try {
    gw = await gatewayFetch<GatewayImageResponse>('/v1/images/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: opts.prompt,
        negativePrompt: opts.negativePrompt,
        width: opts.width,
        height: opts.height,
        n,
        quality: opts.quality ?? policy?.aiImageDefaultQuality ?? 'standard',
        provider: opts.provider,
        providers: policy?.aiImageProviders.length ? policy.aiImageProviders : undefined,
        referenceImageUrl: opts.referenceImageUrl,
        seed: opts.seed,
        namespace: await namespace(),
      }),
    })
  } catch (err) {
    await settle(usageId, { units: [{ type: 'image', qty: 0 }], costInr: 0, latencyMs: Date.now() - started, status: 'failed', error: (err as Error).message }).catch(() => {})
    throw err
  }
  await recordProvider(usageId, gw.provider, gw.model)
  const images: GeneratedImage[] = []
  try {
    for (let i = 0; i < gw.images.length; i++) images.push(await persistImage(gw.images[i], opts, i, gw.model))
  } catch (err) {
    // Provider cost is real; the store got nothing, so it is not charged.
    await settle(usageId, { units: [{ type: 'image', qty: 0 }], costInr: gw.usage?.costInr ?? 0, latencyMs: Date.now() - started, status: 'failed', error: `persist: ${(err as Error).message}` }).catch(() => {})
    throw err instanceof AiMediaError ? err : new AiMediaError(`Could not save the generated image: ${(err as Error).message}`)
  }
  await settle(usageId, {
    units: [{ type: 'image', qty: gw.usage?.units ?? gw.images.length }],
    costInr: gw.usage?.costInr ?? 0,
    latencyMs: gw.latencyMs ?? Date.now() - started,
    cache: gw.cache ?? null,
    status: 'ok',
  })
  return { images, usageId, priceInr: await finalPrice(usageId, priceInr), provider: gw.provider, model: gw.model }
}

export async function generateVideo(opts: GenerateVideoOpts): Promise<GenerateVideoResult> {
  // Veo renders 4, 6 or 8 s; snap to the nearest so the estimate matches what is rendered.
  const durationSec = AI_VIDEO_DURATIONS.reduce((best, d) => (Math.abs(d - (opts.durationSec ?? 4)) < Math.abs(best - (opts.durationSec ?? 4)) ? d : best), 4)
  const aspect: AiVideoAspect = opts.aspect && AI_VIDEO_ASPECTS.includes(opts.aspect) ? opts.aspect : '9:16'
  const { usageId, priceInr } = await preauthorize({
    feature: opts.feature,
    capability: 'video',
    provider: opts.provider ?? 'auto',
    model: 'auto',
    estimateUnits: [{ type: 'video_second', qty: durationSec }],
    ref: opts.ref,
    actor: opts.actor ?? null,
  })
  // i2v models (Replicate wan-2.2-i2v-fast, Veo i2v) derive output aspect from the input shape, so a
  // 1:1 product photo would ignore a 9:16 request. Pad the ref image to the requested aspect first
  // so the model's output matches what the admin picked. Padding failures fall back to the original.
  let gatewayImageUrl = opts.imageUrl
  if (opts.imageUrl && aspect) {
    try {
      const bytes = await fetchBytes(opts.imageUrl)
      const padded = await padToAspect(bytes, aspect)
      if (padded.changed) {
        const key = `ai/video-ref/${usageId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extForMime(padded.mime)}`
        await putObjectBuffer(key, padded.buffer, padded.mime)
        gatewayImageUrl = await getS3Url(key)
      }
    } catch (err) {
      console.warn(`[ai-media] reference image padding failed, using original: ${(err as Error).message}`)
    }
  }
  let gw: GatewayVideoStart
  try {
    gw = await gatewayFetch<GatewayVideoStart>('/v1/video/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: opts.prompt,
        imageUrl: gatewayImageUrl,
        durationSec,
        aspect,
        provider: opts.provider,
        providers: (await getAiRouting().catch(() => ({}) as { video?: string[] })).video,
        namespace: await namespace(),
      }),
    })
  } catch (err) {
    await settle(usageId, { units: [{ type: 'video_second', qty: 0 }], costInr: 0, status: 'failed', error: (err as Error).message }).catch(() => {})
    throw err
  }
  await recordProvider(usageId, gw.provider, gw.model)
  jobs.set(gw.jobId, {
    usageId,
    startedAt: Date.now(),
    tenantId: await resolveTenantIdSafe(),
    prompt: opts.prompt,
    model: gw.model,
    aspect,
    referenceImageUrl: opts.imageUrl ?? null,
  })
  return { jobId: gw.jobId, usageId, estimatedPriceInr: priceInr, provider: gw.provider, model: gw.model }
}

interface JobState {
  usageId: string | null
  startedAt: number
  /** Context captured at generateVideo time so finishJob can write gallery_videos with provenance. */
  tenantId?: string | null
  prompt?: string
  model?: string
  aspect?: AiVideoAspect
  /** User's original reference image URL (pre-padding), kept so provenance records what they picked. */
  referenceImageUrl?: string | null
  done?: VideoJobResult
}

// Per-process memory of started jobs plus an in-flight map so concurrent polls share one finish.
// Across pods the ai_usage row is the record: once it is no longer 'pending' the video was
// persisted (deterministic key) and settled, so a later poll only rebuilds the URL.
const jobs = new Map<string, JobState>()
const finishing = new Map<string, Promise<VideoJobResult>>()

function videoKey(jobId: string, mime?: string): string {
  return `ai/video/${jobId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${mime === 'video/webm' ? 'webm' : 'mp4'}`
}

async function usageStatus(usageId: string): Promise<string | null> {
  const row = await queryOne<{ status: string }>(`SELECT status FROM ai_usage WHERE id = $1 AND capability = 'video'`, [usageId]).catch(() => null)
  return row?.status ?? null
}

export async function videoJob(jobId: string, usageId?: string, tenantIdFallback?: string | null): Promise<VideoJobResult> {
  const state = jobs.get(jobId) ?? { usageId: usageId ?? null, startedAt: Date.now() }
  if (tenantIdFallback && !state.tenantId) state.tenantId = tenantIdFallback
  if (state.done) return state.done
  const inflight = finishing.get(jobId)
  if (inflight) return inflight
  const p = (async (): Promise<VideoJobResult> => {
    const gw = await gatewayFetch<GatewayJob>(`/v1/jobs/${encodeURIComponent(jobId)}`)
    if (gw.status === 'queued' || gw.status === 'running') return { status: gw.status }
    return finishJob(jobId, state, gw)
  })().finally(() => finishing.delete(jobId))
  finishing.set(jobId, p)
  return p
}

async function finishJob(jobId: string, state: JobState, gw: GatewayJob): Promise<VideoJobResult> {
  // Only settle a row that belongs to a video call and is still pending (usageId may come from the client).
  const status = state.usageId ? await usageStatus(state.usageId) : null
  const pending = status === 'pending'
  if (gw.status === 'failed' || !gw.result) {
    const out: VideoJobResult = { status: 'failed', error: gw.error || 'Video generation failed' }
    if (state.usageId && pending) await settle(state.usageId, { units: [{ type: 'video_second', qty: 0 }], costInr: gw.usage?.costInr ?? 0, status: 'failed', error: out.error }).catch(() => {})
    state.done = out
    jobs.set(jobId, state)
    return out
  }
  const key = videoKey(jobId, gw.result.mime)
  if (status === 'ok') {
    // Another poll (or pod) already persisted it; hand back the gallery row it wrote.
    const row = await queryOne<{ id: string; thumbnail_url: string | null }>(
      `SELECT id, thumbnail_url FROM gallery_videos WHERE s3_key = $1 ORDER BY created_at DESC LIMIT 1`,
      [key]
    ).catch(() => null)
    const out: VideoJobResult = { status: 'done', videoUrl: await getS3Url(key), durationSec: gw.result.durationSec }
    if (row) {
      out.galleryVideoId = row.id
      out.posterUrl = row.thumbnail_url
    }
    state.done = out
    jobs.set(jobId, state)
    return out
  }
  const bytes = await fetchBytes(gw.result.videoUrl)
  await putObjectBuffer(key, bytes, gw.result.mime || 'video/mp4')
  const videoUrl = await getS3Url(key)
  const posterUrl = state.referenceImageUrl ?? null
  const out: VideoJobResult = { status: 'done', videoUrl, durationSec: gw.result.durationSec, posterUrl }
  // Land the finished video in the tenant gallery with provenance; a gallery write failure
  // must not fail the job (the caller already has the asset URL).
  try {
    const tenantId = state.tenantId ?? (await resolveTenantIdSafe())
    const row = await queryOne<{ id: string }>(
      `INSERT INTO gallery_videos (tenant_id, s3_bucket, s3_key, url, mime, duration_seconds, aspect, width, height, thumbnail_url, prompt_text, model_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ai') RETURNING id`,
      [tenantId, await currentBucket(), key, videoUrl, gw.result.mime || 'video/mp4', gw.result.durationSec, state.aspect ?? null, gw.result.width || null, gw.result.height || null, posterUrl, state.prompt ?? null, state.model ?? null]
    )
    if (row) out.galleryVideoId = row.id
  } catch (err) {
    console.warn(`[ai-media] gallery_videos insert failed: ${(err as Error).message}`)
  }
  if (state.usageId && pending) {
    await settle(state.usageId, {
      units: [{ type: 'video_second', qty: gw.usage?.units ?? gw.result.durationSec }],
      costInr: gw.usage?.costInr ?? 0,
      latencyMs: Date.now() - state.startedAt,
      status: 'ok',
    })
    out.priceInr = await finalPrice(state.usageId, 0)
  }
  state.done = out
  jobs.set(jobId, state)
  return out
}

/** Test hook. */
export function __resetAiMediaState(): void {
  jobs.clear()
  finishing.clear()
}
