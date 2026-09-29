import { CONFIG, VISION_MODEL } from '../config'
import type { VisionResponse } from '../../../sdk/types'

// Vision primitive: PaddleOCR first (fast, deterministic), Ollama vision model as
// fallback. The domain-specific orchestration (PDF rasterization, quotation-extraction
// prompt) stays in the app; the gateway only owns the two remote calls. Ported from the
// app's vision.ts ocrPaddle() + the Ollama /api/chat image path.

const PADDLE_TIMEOUT_MS = 60_000
const VISION_TIMEOUT_MS = CONFIG.ollamaRequestTimeoutMs

async function paddle(base64: string): Promise<VisionResponse | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PADDLE_TIMEOUT_MS)
  try {
    const res = await fetch(`${CONFIG.paddleOcrUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, mime_type: 'image/png' }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => null) as { ok?: boolean; text?: string; pages?: number } | null
    if (!body?.ok || !body.text) return null
    return { ok: true, text: body.text, model: 'PP-OCRv5', pages: body.pages }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function ollamaVision(base64Images: string[], prompt: string, model: string): Promise<VisionResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt, images: base64Images }],
        options: { temperature: 0.1 },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false, text: '', model,
        error: `Vision model returned ${res.status}: ${body.slice(0, 200)}`,
        hint: `Make sure ${model} is pulled on the Ollama host. Run: ollama pull ${model}`,
      }
    }
    const data = await res.json().catch(() => null) as { message?: { content?: string } } | null
    const text = (data?.message?.content || '').trim()
    return { ok: !!text, text, model }
  } catch (e: any) {
    return {
      ok: false, text: '', model,
      error: e?.name === 'AbortError' ? `Vision request timed out after ${VISION_TIMEOUT_MS / 1000}s` : `Cannot reach vision model: ${String(e?.message || e)}`,
      hint: 'Razer may be asleep or the model is loading. Check the gateway->Ollama connection.',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runVision(images: string[], prompt: string, model?: string): Promise<VisionResponse> {
  // Single-image PaddleOCR fast path (multi-page rasterization is orchestrated app-side,
  // one gateway call per page).
  if (images.length === 1) {
    const p = await paddle(images[0])
    if (p) return p
  }
  return ollamaVision(images, prompt, model || VISION_MODEL)
}
