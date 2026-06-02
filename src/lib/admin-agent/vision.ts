const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:13b'
const VISION_TIMEOUT_MS = 120_000

const EXTRACTION_PROMPT = `You are an OCR assistant for a hardware/industrial supply store. The image is a quotation request from a customer (handwritten note, photo of a printed list, or scanned document).

Extract every line item the customer is asking to be quoted. Output ONLY plain text, one item per line, in this exact format:
QTY UNIT - DESCRIPTION
Examples:
50 nos - M27 high tensile structural bolt
200 pcs - flat washer 8mm
1 set - 12-piece spanner set

Rules:
- Output one line per item only.
- If the unit isn't stated (pcs, nos, kg, set, mtr, etc.), default to "nos".
- If quantity isn't stated, write "1 nos".
- Do NOT add headers, summaries, prices, or commentary.
- Do NOT invent items not visible in the image.
- If the image contains no quotation items at all, output exactly: NO_ITEMS_FOUND`

type VisionResult =
  | { ok: true; text: string; model: string; pages?: number }
  | { ok: false; reason: string; hint?: string }

export async function ocrImage(image: Buffer, mimeType: string): Promise<VisionResult> {
  const base64 = image.toString('base64')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        stream: false,
        messages: [
          {
            role: 'user',
            content: EXTRACTION_PROMPT,
            images: [base64],
          },
        ],
        options: { temperature: 0.1 },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        reason: `Vision model returned ${res.status}: ${body.slice(0, 200)}`,
        hint: `Make sure ${OLLAMA_VISION_MODEL} is pulled on the Ollama host (${OLLAMA_BASE_URL}). Run: ollama pull ${OLLAMA_VISION_MODEL}`,
      }
    }
    const data = await res.json().catch(() => null) as { message?: { content?: string } } | null
    const text = (data?.message?.content || '').trim()
    if (!text || text === 'NO_ITEMS_FOUND') {
      return { ok: false, reason: 'No quotation items detected in the image' }
    }
    return { ok: true, text, model: OLLAMA_VISION_MODEL }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, reason: `Vision request timed out after ${VISION_TIMEOUT_MS / 1000}s`, hint: `Razer may be asleep or model is loading. Retry in a minute.` }
    }
    return {
      ok: false,
      reason: `Cannot reach vision model: ${String(e?.message || e)}`,
      hint: `Check OLLAMA_BASE_URL and Tailscale connection. Default: ${OLLAMA_BASE_URL}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function ocrPdfPages(pdf: Buffer, opts?: { maxPages?: number; perPageTimeoutMs?: number }): Promise<VisionResult> {
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
    return { ok: false, reason: 'PDF rasterized but produced no readable text', hint: 'Try a higher-resolution scan or retype the items.' }
  }

  return { ok: true, text: collected.join('\n\n'), model: OLLAMA_VISION_MODEL, pages }
}

export function isVisionConfigured(): boolean {
  return !!process.env.OLLAMA_BASE_URL || process.env.AI_PROVIDER === 'ollama'
}

export const VISION_MODEL_NAME = OLLAMA_VISION_MODEL
export const VISION_HOST = OLLAMA_BASE_URL
