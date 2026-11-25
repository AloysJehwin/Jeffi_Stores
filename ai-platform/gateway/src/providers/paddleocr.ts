import { CONFIG, VISION_MODEL } from '../config'
import type { OcrLine, OcrResponse, VisionResponse } from '../../../sdk/types'
import { ollamaPool } from './ollama'
import { isNetworkError } from './ollama-pool'
import { BackendProbe } from '../razer-health'

// PaddleOCR sidecar (ai-platform/paddleocr). runOcr() is the deterministic read behind /v1/ocr: the sidecar's
// answer or an error, never a model. runVision() tries it first and falls back to the Ollama vision model. The
// domain-specific orchestration (PDF rasterization, quotation-extraction prompt) stays in the app.

export const OCR_MODEL = 'PP-OCRv5'
/** /v1/ocr's cap on `data`, in base64 characters. */
export const OCR_MAX_BASE64 = 12 * 1024 * 1024
const OCR_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const
type OcrMime = typeof OCR_MIMES[number]
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/

const PADDLE_TIMEOUT_MS = 60_000
const VISION_TIMEOUT_MS = CONFIG.ollamaRequestTimeoutMs

/** 400: the request (or the file in it) is wrong. 503: the sidecar is down or failed. */
export class OcrError extends Error {
  constructor(readonly status: 400 | 503, message: string) { super(message) }
}

/** The file type from its first bytes, for callers that do not say. */
export function sniffMime(base64: string): OcrMime | null {
  const b = Buffer.from(base64.slice(0, 24), 'base64')
  const ascii = (from: number, to: number) => b.subarray(from, to).toString('latin1')
  if (ascii(0, 4) === '%PDF') return 'application/pdf'
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** A /v1/ocr body: bare base64 within the cap, and a supported type (sniffed when absent). Throws OcrError(400). */
export function parseOcrRequest(body: any): { data: string; mime: OcrMime } {
  const data = body?.data
  if (typeof data !== 'string' || !data) throw new OcrError(400, 'data (base64) is required')
  if (data.length > OCR_MAX_BASE64) throw new OcrError(400, `data is too large (max ${OCR_MAX_BASE64 / 1024 / 1024} MB of base64)`)
  if (data.startsWith('data:')) throw new OcrError(400, 'data must be bare base64, without a data: prefix')
  if (!BASE64_RE.test(data)) throw new OcrError(400, 'data is not base64')
  const given = typeof body.mime_type === 'string' ? body.mime_type.trim().toLowerCase().replace(/^image\/jpg$/, 'image/jpeg') : ''
  if (!given) return { data, mime: sniffMime(data) ?? 'image/png' }
  if (!(OCR_MIMES as readonly string[]).includes(given)) throw new OcrError(400, `mime_type must be one of ${OCR_MIMES.join(', ')}`)
  return { data, mime: given as OcrMime }
}

interface SidecarOcr {
  ok?: boolean
  text?: string
  pages?: number
  lines?: OcrLine[]
  mean_score?: number | null
  reason?: string
  code?: string
  detail?: unknown
}

async function checkOcr(): Promise<string | null> {
  try {
    const res = await fetch(`${CONFIG.paddleOcrUrl}/health?ready=1`, { signal: AbortSignal.timeout(CONFIG.ollamaHealthTimeoutMs) })
    if (res.ok) return null
    const body = await res.json().catch(() => null) as { error?: string } | null
    return body?.error || (res.status === 503 ? 'loading the model' : `HTTP ${res.status}`)
  } catch (e: any) {
    return e?.name === 'TimeoutError' ? `timeout ${CONFIG.ollamaHealthTimeoutMs}ms` : String(e?.cause?.code || e?.message || e)
  }
}

/** The sidecar's circuit breaker (probed on the razer cadence; see razer-health.ts). */
export const ocrProbe = new BackendProbe('paddleocr', checkOcr, {
  intervalMs: CONFIG.razerProbeIntervalMs,
  failures: CONFIG.razerBreakerFailures,
})

/** One file read by PaddleOCR. Throws OcrError: 400 when it rejects the input, 503 when it is down or fails. */
export async function runOcr(base64: string, mime: string, timeoutMs = CONFIG.paddleOcrTimeoutMs): Promise<OcrResponse> {
  if (ocrProbe.isOpen()) throw new OcrError(503, `PaddleOCR is down (${ocrProbe.status().reason}); retry once it recovers`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let status: number
  let raw: string
  try {
    const res = await fetch(`${CONFIG.paddleOcrUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, mime_type: mime }),
      signal: ctrl.signal,
    })
    status = res.status
    raw = await res.text()
  } catch (e: any) {
    ocrProbe.recordFailure()
    throw new OcrError(503, e?.name === 'AbortError'
      ? `PaddleOCR timed out after ${timeoutMs / 1000}s`
      : `PaddleOCR unreachable: ${e?.cause?.code || e?.message || e}`)
  } finally {
    clearTimeout(timer)
  }
  let body: SidecarOcr | null = null
  try { body = JSON.parse(raw) } catch {}
  if (status >= 400 && status < 500) {
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? raw).slice(0, 300)
    throw new OcrError(400, `PaddleOCR rejected the file: ${detail}`)
  }
  if (status !== 200 || !body) {
    if (status >= 502) ocrProbe.recordFailure()
    throw new OcrError(503, `PaddleOCR HTTP ${status}: ${raw.slice(0, 200)}`)
  }
  const pages = body.pages || 1
  if (body.ok && typeof body.text === 'string') {
    return { ok: true, text: body.text, lines: body.lines ?? [], meanScore: body.mean_score ?? null, pages, model: OCR_MODEL, provider: 'paddleocr' }
  }
  // Read fine and found nothing: an answer, not an outage.
  if (body.code === 'no_text') return { ok: true, text: '', lines: [], meanScore: null, pages, model: OCR_MODEL, provider: 'paddleocr' }
  throw new OcrError(body.code === 'unsupported_mime' ? 400 : 503, body.reason || 'PaddleOCR returned no result')
}

export interface OcrHealth { ok: boolean; reason?: string; checkedAt: number | null }

/** The last sidecar probe (startOcrProbe keeps it fresh), for /readyz and /v1/providers. */
export function ocrStatus(): OcrHealth {
  const s = ocrProbe.status()
  return { ok: s.ok, reason: s.reason, checkedAt: s.checkedAt }
}

/** Probe the sidecar now and on the razer cadence, logging each change like the Ollama pool. */
export function startOcrProbe(): void {
  ocrProbe.start()
}

async function paddle(base64: string): Promise<VisionResponse | null> {
  try {
    const r = await runOcr(base64, sniffMime(base64) ?? 'image/png', PADDLE_TIMEOUT_MS)
    return r.text ? { ok: true, text: r.text, model: OCR_MODEL, pages: r.pages, provider: 'paddleocr' } : null
  } catch {
    return null
  }
}

// Network errors are rethrown so the pool fails over to the next Ollama URL.
async function ollamaVisionAt(base: string, base64Images: string[], prompt: string, model: string): Promise<VisionResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/chat`, {
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
    return { ok: !!text, text, model, provider: 'ollama' }
  } catch (e: any) {
    if (isNetworkError(e)) throw e
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
  const m = model || VISION_MODEL
  try {
    return await ollamaPool.withOllama(base => ollamaVisionAt(base, images, prompt, m))
  } catch (e: any) {
    return {
      ok: false, text: '', model: m,
      error: `Cannot reach vision model: ${String(e?.message || e)}`,
      hint: 'Check the gateway->Ollama connection (GET /readyz).',
    }
  }
}
