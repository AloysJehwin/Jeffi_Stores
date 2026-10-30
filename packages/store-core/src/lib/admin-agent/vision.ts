import { aiVision } from '@/lib/shared/ai-client'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { pdfPageImages } from './pdf'

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

const generalPrompt = (store: string) => `You are reading a file for the admin of ${store}. Transcribe ALL the text in the image exactly as written, keeping its layout (lines, columns and tables as plain text rows).
Then, on a new line starting "Image:", describe in one or two sentences anything that is not text (a product photo, a damaged item, a receipt, a screenshot of an app...).
If there is no text at all, output only the "Image:" line.`

type VisionResult =
  { ok: true; text: string; model: string; pages?: number } | { ok: false; reason: string; hint?: string }

/** quotation: the line items as "QTY UNIT - DESCRIPTION"; general: all the text plus what the image shows. */
export async function ocrImage(image: Buffer, purpose: 'quotation' | 'general' = 'quotation'): Promise<VisionResult> {
  // The gateway runs Claude when it leads the text order, else PaddleOCR then the Ollama vision model.
  const store = await storeDescriptorForPrompt()
  const r = await aiVision([image.toString('base64')], purpose === 'quotation' ? extractionPrompt(store) : generalPrompt(store), undefined, {
    feature: purpose === 'quotation' ? 'quotation_ocr' : 'agent_file_read',
  })
  if (!r.ok || !r.text) {
    return { ok: false, reason: r.error || 'No text detected in the image', hint: r.hint }
  }
  const text = r.text.trim()
  if (!text || (purpose === 'quotation' && text === 'NO_ITEMS_FOUND')) {
    return { ok: false, reason: 'No quotation items detected in the image' }
  }
  return { ok: true, text, model: r.model, pages: r.pages }
}

export async function ocrPdfPages(
  pdf: Buffer,
  opts?: { maxPages?: number; perPageTimeoutMs?: number; purpose?: 'quotation' | 'general' }
): Promise<VisionResult> {
  // Rasterize app-side, then OCR each page image through the gateway.
  const maxPages = Math.max(1, Math.min(20, opts?.maxPages ?? 10))
  let pages = 0
  const collected: string[] = []

  try {
    for await (const pageBuf of pdfPageImages(pdf, { maxPages, scale: 2 })) {
      pages++
      const r = await ocrImage(pageBuf, opts?.purpose ?? 'quotation')
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
