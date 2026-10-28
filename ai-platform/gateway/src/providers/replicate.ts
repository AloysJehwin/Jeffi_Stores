// Replicate (BFL Flux images, Wan 2.2 text-to-video / image-to-video).
// POST /v1/models/<owner>/<name>/predictions   → { id, status, urls:{get} }
// GET  /v1/predictions/<id>                    → { status: starting|processing|succeeded|failed|canceled, output, error }
// output is a URL string or array of URL strings. For video we pick the first.
// Video models:
//   wan-video/wan-2.2-t2v-fast — accepts aspect_ratio in {'16:9','9:16'}, resolution in {'480p','720p'}.
//   wan-video/wan-2.2-i2v-fast — NO aspect_ratio field (output aspect comes from the input image);
//                                 resolution in {'480p','720p'}.
// We default resolution to '720p' for both; num_frames clamps to the model's floor (81).
// Background removal (transparent images): REPLICATE_BG_REMOVAL_MODEL, default bria/remove-background
// (RMBG 2.0, takes `image`, returns a PNG URL). An `owner/name:version` id runs a pinned community model.

import type { BackgroundRemover, GeneratedImage, ImageGenInput, ImageGenOutput, MediaProvider, VideoGenInput, VideoPoll, VideoStart } from './types'
import { ProviderError, fetchBytes, fetchJson, loadImage, nearestAspect, toImage } from './types'

const BASE = 'https://api.replicate.com/v1'
const IMAGE_MODELS: Record<string, string> = {
  draft: 'black-forest-labs/flux-schnell',
  standard: 'black-forest-labs/flux-dev',
  premium: 'black-forest-labs/flux-1.1-pro',
}
const VIDEO_T2V = 'wan-video/wan-2.2-t2v-fast'
const VIDEO_I2V = 'wan-video/wan-2.2-i2v-fast'
export const DEFAULT_BG_REMOVAL_MODEL = 'bria/remove-background'

interface PredictionResponse {
  id?: string
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string | string[] | null
  error?: string | null
  urls?: { get?: string }
}

const FLUX_ASPECTS = ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16', '9:21']

export class ReplicateProvider implements MediaProvider, BackgroundRemover {
  readonly name = 'replicate' as const
  constructor(
    private readonly token = process.env.REPLICATE_API_TOKEN || '',
    private readonly timeoutMs = Number(process.env.REPLICATE_TIMEOUT_MS) || 180_000,
    private readonly bgModel = process.env.REPLICATE_BG_REMOVAL_MODEL || DEFAULT_BG_REMOVAL_MODEL,
  ) {}

  configured(): boolean { return !!this.token }

  cutoutModel(): string { return this.bgModel }

  async removeBackground(img: GeneratedImage): Promise<GeneratedImage> {
    this.assert()
    const pred = await this.create(this.bgModel, { image: `data:${img.mime};base64,${img.bytes.toString('base64')}` })
    const done = await this.waitUntilDone(pred)
    const url = urlList(done.output)[0]
    if (!url) throw new ProviderError('replicate', 'background removal returned no image')
    const { bytes, mime } = await fetchBytes('replicate', url, { timeoutMs: 60_000 })
    return toImage(bytes, mime.startsWith('image/') ? mime : 'image/png', { width: img.width, height: img.height })
  }

  async generateImage(req: ImageGenInput): Promise<ImageGenOutput> {
    this.assert()
    const model = IMAGE_MODELS[req.quality] ?? IMAGE_MODELS.standard
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      num_outputs: req.n,
      // Flux on Replicate takes an aspect label, not custom pixel sizes.
      aspect_ratio: nearestAspect(req.width, req.height, FLUX_ASPECTS),
      output_format: 'png',
    }
    if (req.negativePrompt && model.includes('dev')) input.negative_prompt = req.negativePrompt
    if (typeof req.seed === 'number') input.seed = req.seed
    if (req.referenceImageUrl) input.image = req.referenceImageUrl
    const pred = await this.create(model, input)
    const done = await this.waitUntilDone(pred)
    const urls = urlList(done.output)
    if (!urls.length) throw new ProviderError('replicate', 'no output urls')
    const n = Math.min(req.n, urls.length)
    const images = await Promise.all(urls.slice(0, n).map(async u => {
      const { bytes, mime } = await fetchBytes('replicate', u, { timeoutMs: 60_000 })
      return toImage(bytes, mime.startsWith('image/') ? mime : 'image/png', { width: req.width, height: req.height })
    }))
    return { images, model }
  }

  videoModel(req: VideoGenInput): string {
    return req.imageUrl ? VIDEO_I2V : VIDEO_T2V
  }

  async startVideo(req: VideoGenInput): Promise<VideoStart> {
    this.assert()
    const model = this.videoModel(req)
    // wan-2.2 i2v/t2v on Replicate requires num_frames >= 81; a 4s @16fps request
    // (64 frames) 422s otherwise. Clamp up to the model's floor so short-duration
    // picks render a ~5s clip instead of failing.
    const MIN_FRAMES = 81
    const num_frames = Math.max(MIN_FRAMES, Math.round(req.durationSec * 16))
    const input: Record<string, unknown> = req.imageUrl
      ? {
          // i2v: aspect comes from the input image; aspect_ratio is not a schema field.
          prompt: req.prompt,
          image: await this.toDataUrl(req.imageUrl),
          num_frames,
          frames_per_second: 16,
          resolution: '720p',
        }
      : {
          // t2v: aspect_ratio enum ['16:9','9:16']; caller already normalises.
          prompt: req.prompt,
          aspect_ratio: req.aspect,
          num_frames,
          frames_per_second: 16,
          resolution: '720p',
        }
    const pred = await this.create(model, input)
    if (!pred.id) throw new ProviderError('replicate', 'prediction missing id')
    return { opId: pred.id, model, durationSec: req.durationSec }
  }

  private async toDataUrl(url: string): Promise<string> {
    const img = await loadImage('replicate', url)
    return `data:${img.mime};base64,${img.data}`
  }

  async pollVideo(opId: string, model: string): Promise<VideoPoll> {
    this.assert()
    const p = await this.get(opId)
    if (p.status === 'failed' || p.status === 'canceled') return { done: true, error: p.error || p.status }
    if (p.status !== 'succeeded') return { done: false }
    const url = urlList(p.output)[0]
    if (!url) return { done: true, error: 'no output url' }
    const { bytes, mime } = await fetchBytes('replicate', url, { timeoutMs: this.timeoutMs })
    return { done: true, result: { bytes, mime: mime || 'video/mp4', width: 0, height: 0, durationSec: 0 } }
  }

  private async create(model: string, input: Record<string, unknown>): Promise<PredictionResponse> {
    const [name, version] = model.split(':')
    return fetchJson<PredictionResponse>('replicate', version ? `${BASE}/predictions` : `${BASE}/models/${name}/predictions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(version ? { version, input } : { input }),
      timeoutMs: 30_000,
    })
  }

  private async get(id: string): Promise<PredictionResponse> {
    return fetchJson<PredictionResponse>('replicate', `${BASE}/predictions/${id}`, {
      headers: this.headers(),
      timeoutMs: 15_000,
    })
  }

  // Images: synchronous flow via polling with Prefer:wait is not reliable across models,
  // so we poll like videos (same code path, short interval). ~3 s start-up for schnell.
  private async waitUntilDone(start: PredictionResponse): Promise<PredictionResponse> {
    const deadline = Date.now() + this.timeoutMs
    let p = start
    while (p.status === 'starting' || p.status === 'processing') {
      if (Date.now() > deadline) throw new ProviderError('replicate', 'image timed out')
      await sleep(1500)
      if (!p.id) throw new ProviderError('replicate', 'prediction missing id')
      p = await this.get(p.id)
    }
    if (p.status !== 'succeeded') throw new ProviderError('replicate', p.error || p.status || 'failed')
    return p
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }
  }

  private assert(): void {
    if (!this.configured()) throw new ProviderError('replicate', 'REPLICATE_API_TOKEN not set')
  }
}

function urlList(out: PredictionResponse['output']): string[] {
  if (!out) return []
  if (typeof out === 'string') return [out]
  return out.filter(u => typeof u === 'string')
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

export const replicateProvider = new ReplicateProvider()
