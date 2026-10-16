// Replicate (BFL Flux images, Wan 2.2 text-to-video).
// POST /v1/models/<owner>/<name>/predictions   → { id, status, urls:{get} }
// GET  /v1/predictions/<id>                    → { status: starting|processing|succeeded|failed|canceled, output, error }
// output is a URL string or array of URL strings. For video we pick the first.
// Video model picked: wan-video/wan-2.2-t2v-fast — currently available and cheap (480p, ~5 s).

import type { ImageGenInput, ImageGenOutput, MediaProvider, VideoGenInput, VideoPoll, VideoStart } from './types'
import { ProviderError, fetchBytes, fetchJson, loadImage, toImage } from './types'

const BASE = 'https://api.replicate.com/v1'
const IMAGE_MODELS: Record<string, string> = {
  draft: 'black-forest-labs/flux-schnell',
  standard: 'black-forest-labs/flux-dev',
  premium: 'black-forest-labs/flux-1.1-pro',
}
const VIDEO_T2V = 'wan-video/wan-2.2-t2v-fast'
const VIDEO_I2V = 'wan-video/wan-2.2-i2v-fast'

interface PredictionResponse {
  id?: string
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string | string[] | null
  error?: string | null
  urls?: { get?: string }
}

export class ReplicateProvider implements MediaProvider {
  readonly name = 'replicate' as const
  constructor(
    private readonly token = process.env.REPLICATE_API_TOKEN || '',
    private readonly timeoutMs = Number(process.env.REPLICATE_TIMEOUT_MS) || 180_000,
  ) {}

  configured(): boolean { return !!this.token }

  async generateImage(req: ImageGenInput): Promise<ImageGenOutput> {
    this.assert()
    const model = IMAGE_MODELS[req.quality] ?? IMAGE_MODELS.standard
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      width: req.width,
      height: req.height,
      num_outputs: req.n,
      aspect_ratio: 'custom',
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
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspect,
      num_frames: Math.round(req.durationSec * 16),
      frames_per_second: 16,
    }
    if (req.imageUrl) {
      const img = await loadImage('replicate', req.imageUrl)
      input.image = `data:${img.mime};base64,${img.data}`
    }
    const pred = await this.create(model, input)
    if (!pred.id) throw new ProviderError('replicate', 'prediction missing id')
    return { opId: pred.id, model, durationSec: req.durationSec }
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
    return fetchJson<PredictionResponse>('replicate', `${BASE}/models/${model}/predictions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ input }),
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
