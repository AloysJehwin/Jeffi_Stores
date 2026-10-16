// Razer: Automatic1111-compatible API (SD WebUI, SD.Next, ComfyUI's a1111 adapter).
// POST /sdapi/v1/txt2img, /sdapi/v1/img2img. Returns base64 PNG per sample.

import type { ImageGenInput, ImageGenOutput, MediaProvider } from './types'
import { ProviderError, fetchJson, loadImage, toImage } from './types'

interface A1111Response { images?: string[]; info?: string; parameters?: Record<string, unknown> }
interface A1111Options { sd_model_checkpoint?: string }

export class SdWebuiProvider implements MediaProvider {
  readonly name = 'razer' as const
  constructor(
    private readonly url = (process.env.SD_WEBUI_URL || '').replace(/\/$/, ''),
    private readonly model = process.env.SD_MODEL || '',
    private readonly steps = Number(process.env.SD_STEPS) || 25,
    private readonly cfg = Number(process.env.SD_CFG) || 7,
    private readonly sampler = process.env.SD_SAMPLER || 'DPM++ 2M Karras',
    private readonly timeoutMs = Number(process.env.SD_TIMEOUT_MS) || 180_000,
  ) {}

  configured(): boolean { return !!this.url }

  async generateImage(req: ImageGenInput): Promise<ImageGenOutput> {
    if (!this.configured()) throw new ProviderError('razer', 'SD_WEBUI_URL not set')
    const base = {
      prompt: req.prompt,
      negative_prompt: req.negativePrompt || '',
      width: req.width,
      height: req.height,
      batch_size: req.n,
      n_iter: 1,
      steps: req.quality === 'draft' ? Math.max(10, Math.floor(this.steps / 2)) : this.steps,
      cfg_scale: this.cfg,
      sampler_name: this.sampler,
      seed: req.seed ?? -1,
      send_images: true,
      save_images: false,
      override_settings: this.model ? { sd_model_checkpoint: this.model } : undefined,
    }
    const path = req.referenceImageUrl ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img'
    const body: Record<string, unknown> = { ...base }
    if (req.referenceImageUrl) {
      const img = await loadImage('razer', req.referenceImageUrl)
      body.init_images = [img.data]
      body.denoising_strength = 0.6
    }
    const res = await fetchJson<A1111Response>('razer', `${this.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    })
    if (!res.images?.length) throw new ProviderError('razer', 'no images returned')
    const model = this.model || (await this.currentModel()) || 'sd-webui'
    const images = res.images.slice(0, req.n).map(b64 => toImage(Buffer.from(b64, 'base64'), 'image/png', { width: req.width, height: req.height }))
    return { images, model }
  }

  private async currentModel(): Promise<string | null> {
    try {
      const o = await fetchJson<A1111Options>('razer', `${this.url}/sdapi/v1/options`, { timeoutMs: 5_000 })
      return o?.sd_model_checkpoint?.replace(/\s*\[[^\]]+\]\s*$/, '') || null
    } catch { return null }
  }
}

export const sdWebuiProvider = new SdWebuiProvider()
