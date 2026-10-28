import type { ImageProviderName, VideoProviderName, ImageQuality, VideoAspect } from '../../../sdk/types'

export type { ImageProviderName, VideoProviderName, ImageQuality, VideoAspect }

/** Validated, clamped image request as providers see it. */
export interface ImageGenInput {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  n: number
  quality: ImageQuality
  seed?: number
  referenceImageUrl?: string
  /** Subject will be cut out afterwards; providers see the prompt with the isolation hint already added. */
  transparent?: boolean
}

export interface GeneratedImage {
  bytes: Buffer
  mime: string
  width: number
  height: number
}

export interface ImageGenOutput {
  images: GeneratedImage[]
  model: string
}

export interface VideoGenInput {
  prompt: string
  imageUrl?: string
  /** Snapped to what the provider supports; 2..8 at the API edge. */
  durationSec: number
  aspect: VideoAspect
}

export interface VideoStart {
  opId: string
  model: string
  /** Duration the provider will actually produce. */
  durationSec: number
  /** Aspect the provider will actually produce, when it differs from the request. */
  aspect?: VideoAspect
}

export interface VideoResult {
  bytes: Buffer
  mime: string
  width: number
  height: number
  durationSec: number
}

export interface VideoPoll {
  done: boolean
  result?: VideoResult
  error?: string
}

export interface MediaProvider {
  readonly name: ImageProviderName | VideoProviderName
  configured(): boolean
  generateImage?(req: ImageGenInput): Promise<ImageGenOutput>
  /** Model the provider will use for this video request (for the cost estimate before starting). */
  videoModel?(req: VideoGenInput): string
  startVideo?(req: VideoGenInput): Promise<VideoStart>
  pollVideo?(opId: string, model: string): Promise<VideoPoll>
}

/** Post-step that cuts the subject out to a transparent PNG. */
export interface BackgroundRemover {
  configured(): boolean
  cutoutModel(): string
  removeBackground(img: GeneratedImage): Promise<GeneratedImage>
}

export class ProviderError extends Error {
  constructor(readonly provider: string, message: string, readonly status?: number) {
    super(`${provider}: ${message}`)
    this.name = 'ProviderError'
  }
}

export interface HttpOpts { timeoutMs?: number }

/** fetch with a timeout; throws ProviderError on non-2xx with the body as detail. */
export async function fetchJson<T>(provider: string, url: string, init: RequestInit & HttpOpts = {}): Promise<T> {
  const res = await fetchRaw(provider, url, init)
  return (await res.json()) as T
}

export async function fetchBytes(provider: string, url: string, init: RequestInit & HttpOpts = {}): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetchRaw(provider, url, init)
  const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
  return { bytes: Buffer.from(await res.arrayBuffer()), mime }
}

async function fetchRaw(provider: string, url: string, init: RequestInit & HttpOpts): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(provider, `HTTP ${res.status} ${body.slice(0, 500)}`, res.status)
    }
    return res
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw new ProviderError(provider, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(t)
  }
}

/** Load an http(s) or data: URL as base64 + mime (reference images, image-to-video). */
export async function loadImage(provider: string, url: string): Promise<{ data: string; mime: string }> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (m) return { mime: m[1], data: m[2] }
  const { bytes, mime } = await fetchBytes(provider, url, { timeoutMs: 30_000 })
  return { data: bytes.toString('base64'), mime: mime.startsWith('image/') ? mime : 'image/png' }
}

const ASPECTS: Record<string, number> = {
  '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16,
  '3:2': 3 / 2, '2:3': 2 / 3, '4:5': 4 / 5, '5:4': 5 / 4, '21:9': 21 / 9, '9:21': 9 / 21,
}

/** Nearest supported aspect ratio label for a width/height. */
export function nearestAspect(width: number, height: number, allowed: string[]): string {
  const r = width / height
  let best = allowed[0]
  let bestDiff = Infinity
  for (const a of allowed) {
    const d = Math.abs(Math.log((ASPECTS[a] ?? 1) / r))
    if (d < bestDiff) { bestDiff = d; best = a }
  }
  return best
}

/** Pixel size of a PNG, JPEG or WebP buffer; null when unreadable. */
export function imageDims(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return null
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  }
  return null
}

export function toImage(bytes: Buffer, mime: string, fallback: { width: number; height: number }): GeneratedImage {
  const d = imageDims(bytes) ?? fallback
  return { bytes, mime, width: d.width, height: d.height }
}
