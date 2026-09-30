import { aiVision } from '@/lib/shared/ai-client'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'

// OCR/vision now runs through the ai-platform gateway (PaddleOCR-first, Ollama-vision fallback,
// queue + retry). This file keeps the DOMAIN logic — the quotation extraction prompt and PDF
// rasterization — and calls the gateway one image at a time.

const extractionPrompt = (
  store: string
) => `You are an OCR assistant for ${store}. The image is a quotation request from a customer (handwritten note, photo of a printed list, or scanned document).

Extract every line item the customer is asking to be quoted. Output ONLY plain text, one item per line, in this exact format:
QTY UNIT - DESCRIPTION
Examples (format only, not this store's products):
50 nos - <item as written by the customer>
200 pcs - <item as written by the customer>
1 set - <item as written by the customer>

Rules:
- Output one line per item only.
- If the unit isn't stated (pcs, nos, kg, set, mtr, etc.), default to "nos".
- If quantity isn't stated, write "1 nos".
- Do NOT add headers, summaries, prices, or commentary.
- Do NOT invent items not visible in the image.
- If the image contains no quotation items at all, output exactly: NO_ITEMS_FOUND`

type VisionResult =
  { ok: true; text: string; model: string; pages?: number } | { ok: false; reason: string; hint?: string }

export async function ocrImage(image: Buffer, _mimeType: string): Promise<VisionResult> {
  // The gateway runs PaddleOCR first, then the Ollama vision model as fallback.
  const r = await aiVision([image.toString('base64')], extractionPrompt(await storeDescriptorForPrompt()))
  if (!r.ok || !r.text) {
    return { ok: false, reason: r.error || 'No text detected in the image', hint: r.hint }
  }
  const text = r.text.trim()
  if (!text || text === 'NO_ITEMS_FOUND') {
    return { ok: false, reason: 'No quotation items detected in the image' }
  }
  return { ok: true, text, model: r.model, pages: r.pages }
}

export async function ocrPdfPages(
  pdf: Buffer,
  opts?: { maxPages?: number; perPageTimeoutMs?: number }
): Promise<VisionResult> {
  // Rasterize app-side, then OCR each page image through the gateway.
  const maxPages = Math.max(1, Math.min(20, opts?.maxPages ?? 10))
  let pages = 0
  const collected: string[] = []

  let pdfToImg: any
  try {
    pdfToImg = await import('pdf-to-img')
  } catch (e: any) {
    return { ok: false, reason: `pdf-to-img not available: ${String(e?.message || e)}` }
  }
  const { pdf: pdfRender } = pdfToImg

  try {
    const document = await pdfRender(pdf, { scale: 2 })
    for await (const pageBuf of document) {
      pages++
      if (pages > maxPages) break
      const r = await ocrImage(pageBuf as Buffer, 'image/png')
      if (!r.ok) {
        if (collected.length === 0) {
          return { ok: false, reason: `Page ${pages} OCR failed: ${r.reason}`, hint: r.hint }
        }
        break
      }
      collected.push(`--- Page ${pages} ---\n${r.text}`)
    }
  } catch (e: any) {
    if (collected.length === 0) {
      return { ok: false, reason: `Failed to rasterize PDF: ${String(e?.message || e)}` }
    }
  }

  if (collected.length === 0) {
    return {
      ok: false,
      reason: 'PDF rasterized but produced no readable text',
      hint: 'Try a higher-resolution scan or retype the items.',
    }
  }

  return { ok: true, text: collected.join('\n\n'), model: 'gateway-vision', pages }
}

export function isVisionConfigured(): boolean {
  return (
    !!process.env.AI_GATEWAY_URL ||
    !!process.env.PADDLE_OCR_URL ||
    !!process.env.OLLAMA_BASE_URL ||
    process.env.AI_PROVIDER === 'ollama'
  )
}

export const VISION_MODEL_NAME = process.env.OLLAMA_VISION_MODEL || 'gemma4:12b'
export const VISION_HOST = (process.env.AI_GATEWAY_URL || '').replace(/\/$/, '')
