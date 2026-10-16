// Google (Gemini API): Gemini image models for images, Veo for video.
// Checked against ai.google.dev on 2026-10-16:
// - Imagen is shut down in the Gemini API (docs/imagen). Images use the Interactions API from
//   docs/image-generation:
//     POST /v1beta/interactions { model, input: string | [{type:'text',text},{type:'image',mime_type,data}],
//                                 response_format: { type:'image', aspect_ratio, image_size } }
//     -> { status, steps: [{ type:'model_output', content: [{ type:'image', data, mime_type }] }] }
//   One image per call, so n images means n calls. The Imagen ":predict" path is kept only as an
//   opt-in fallback (GOOGLE_IMAGEN_MODEL) for keys that still have access.
// - Veo (docs/veo): POST /v1beta/models/<model>:predictLongRunning
//     { instances:[{ prompt, image?:{inlineData:{mimeType,data}} }], parameters:{ aspectRatio, durationSeconds:"4"|"6"|"8", resolution, numberOfVideos } }
//     -> { name }; GET /v1beta/<name> -> { done, response.generateVideoResponse.generatedSamples[0].video.uri }
//   The uri is downloaded with the x-goog-api-key header. Aspect 16:9 or 9:16 only.

import type { ImageGenInput, ImageGenOutput, MediaProvider, VideoGenInput, VideoPoll, VideoStart } from './types'
import { ProviderError, fetchBytes, fetchJson, loadImage, nearestAspect, toImage } from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface InteractionContent { type?: string; data?: string; mime_type?: string }
interface InteractionResponse { status?: string; steps?: { type?: string; content?: InteractionContent[] }[]; error?: { message?: string } }
interface ImagenPrediction { bytesBase64Encoded?: string; mimeType?: string }
interface ImagenResponse { predictions?: ImagenPrediction[] }
interface VeoStartResponse { name?: string }
interface VeoOperation {
  name?: string
  done?: boolean
  error?: { message?: string }
  response?: {
    generateVideoResponse?: { generatedSamples?: { video?: { uri?: string }; mimeType?: string }[] }
    // Older shape kept defensively.
    generatedVideos?: { video?: { uri?: string }; mimeType?: string }[]
  }
}

const GEMINI_IMAGE_ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const IMAGEN_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9']
const VIDEO_ASPECTS = ['16:9', '9:16']
const VEO_DURATIONS = [4, 6, 8] as const

export class GoogleProvider implements MediaProvider {
  readonly name = 'google' as const
  constructor(
    private readonly apiKey = process.env.GOOGLE_AI_API_KEY || '',
    private readonly imageModel = process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image',
    private readonly premiumImageModel = process.env.GOOGLE_IMAGE_PREMIUM_MODEL || 'gemini-3-pro-image',
    private readonly imagenModel = process.env.GOOGLE_IMAGEN_MODEL || '',
    private readonly veoModel = process.env.GOOGLE_VEO_MODEL || 'veo-3.1-fast-generate-preview',
    private readonly veoFallback = process.env.GOOGLE_VEO_FALLBACK || 'veo-3.0-generate-001',
    private readonly timeoutMs = Number(process.env.GOOGLE_TIMEOUT_MS) || 120_000,
  ) {}

  configured(): boolean { return !!this.apiKey }

  async generateImage(req: ImageGenInput): Promise<ImageGenOutput> {
    this.assert()
    const model = req.quality === 'premium' ? this.premiumImageModel : this.imageModel
    try { return await this.geminiAt(model, req) }
    catch (err) {
      if (!this.imagenModel) throw err
      return await this.imagenAt(this.imagenModel, req)
    }
  }

  private async geminiAt(model: string, req: ImageGenInput): Promise<ImageGenOutput> {
    const text = req.negativePrompt ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}` : req.prompt
    let input: unknown = text
    if (req.referenceImageUrl) {
      const img = await loadImage('google', req.referenceImageUrl)
      input = [{ type: 'text', text }, { type: 'image', mime_type: img.mime, data: img.data }]
    }
    const body: Record<string, unknown> = {
      model,
      input,
      response_format: {
        type: 'image',
        aspect_ratio: nearestAspect(req.width, req.height, GEMINI_IMAGE_ASPECTS),
        image_size: Math.max(req.width, req.height) > 1024 ? '2K' : '1K',
      },
      store: false,
    }
    if (typeof req.seed === 'number') body.generation_config = { seed: req.seed }
    const one = async () => {
      const r = await fetchJson<InteractionResponse>('google', `${BASE}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      })
      if (r.error?.message) throw new ProviderError('google', r.error.message)
      const img = (r.steps || []).flatMap(s => s.content || []).filter(c => c.type === 'image' && c.data).pop()
      if (!img?.data) throw new ProviderError('google', `no image in interaction (status ${r.status || 'unknown'})`)
      return toImage(Buffer.from(img.data, 'base64'), img.mime_type || 'image/png', { width: req.width, height: req.height })
    }
    const images = await Promise.all(Array.from({ length: req.n }, one))
    return { images, model }
  }

  private async imagenAt(model: string, req: ImageGenInput): Promise<ImageGenOutput> {
    const parameters: Record<string, unknown> = {
      sampleCount: req.n,
      aspectRatio: nearestAspect(req.width, req.height, IMAGEN_ASPECTS),
    }
    if (req.negativePrompt) parameters.negativePrompt = req.negativePrompt
    if (typeof req.seed === 'number') parameters.seed = req.seed
    const instance: Record<string, unknown> = { prompt: req.prompt }
    if (req.referenceImageUrl) {
      const img = await loadImage('google', req.referenceImageUrl)
      instance.image = { bytesBase64Encoded: img.data, mimeType: img.mime }
    }
    const r = await fetchJson<ImagenResponse>('google', `${BASE}/models/${model}:predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ instances: [instance], parameters }),
      timeoutMs: this.timeoutMs,
    })
    const preds = (r.predictions || []).filter(p => p.bytesBase64Encoded)
    if (!preds.length) throw new ProviderError('google', 'imagen returned no predictions')
    const images = preds.slice(0, req.n).map(p =>
      toImage(Buffer.from(p.bytesBase64Encoded!, 'base64'), p.mimeType || 'image/png', { width: req.width, height: req.height }),
    )
    return { images, model }
  }

  videoModel(_req: VideoGenInput): string {
    return this.veoModel
  }

  async startVideo(req: VideoGenInput): Promise<VideoStart> {
    this.assert()
    try { return await this.veoAt(this.veoModel, req) }
    catch (err) {
      if (!this.veoFallback || this.veoFallback === this.veoModel) throw err
      return await this.veoAt(this.veoFallback, req)
    }
  }

  private async veoAt(model: string, req: VideoGenInput): Promise<VideoStart> {
    // Veo has no 1:1; square requests get 9:16 (social-first).
    const aspect = VIDEO_ASPECTS.includes(req.aspect) ? req.aspect : '9:16'
    const duration = snap(VEO_DURATIONS, req.durationSec)
    const parameters: Record<string, unknown> = {
      aspectRatio: aspect,
      durationSeconds: String(duration),
      resolution: '720p',
      numberOfVideos: 1,
    }
    const instance: Record<string, unknown> = { prompt: req.prompt }
    if (req.imageUrl) {
      const img = await loadImage('google', req.imageUrl)
      instance.image = { inlineData: { mimeType: img.mime, data: img.data } }
    }
    const r = await fetchJson<VeoStartResponse>('google', `${BASE}/models/${model}:predictLongRunning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ instances: [instance], parameters }),
      timeoutMs: this.timeoutMs,
    })
    if (!r.name) throw new ProviderError('google', 'veo did not return an operation name')
    return { opId: r.name, model, durationSec: duration, aspect: aspect as VideoGenInput['aspect'] }
  }

  async pollVideo(opId: string, model: string): Promise<VideoPoll> {
    this.assert()
    const op = await fetchJson<VeoOperation>('google', `${BASE}/${opId}`, {
      headers: { 'x-goog-api-key': this.apiKey },
      timeoutMs: 30_000,
    })
    if (op.error?.message) return { done: true, error: op.error.message }
    if (!op.done) return { done: false }
    const sample = op.response?.generateVideoResponse?.generatedSamples?.[0] ?? op.response?.generatedVideos?.[0]
    const uri = sample?.video?.uri
    if (!uri) return { done: true, error: 'veo response missing video uri' }
    const { bytes, mime } = await fetchBytes('google', uri, {
      headers: { 'x-goog-api-key': this.apiKey },
      timeoutMs: this.timeoutMs,
    })
    // 720p; width/height/duration filled from the job's aspect and duration.
    return { done: true, result: { bytes, mime: mime || 'video/mp4', width: 0, height: 0, durationSec: 0 } }
  }

  private assert(): void {
    if (!this.configured()) throw new ProviderError('google', 'GOOGLE_AI_API_KEY not set')
  }
}

function snap<T extends number>(allowed: readonly T[], v: number): T {
  let best = allowed[0]
  let diff = Math.abs(v - best)
  for (const a of allowed) { const d = Math.abs(v - a); if (d < diff) { diff = d; best = a } }
  return best
}

export const googleProvider = new GoogleProvider()
