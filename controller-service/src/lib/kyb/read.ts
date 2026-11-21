import 'server-only'
import sharp from 'sharp'
import { pdfPageImages, pdfText } from '@/lib/admin-agent/pdf'
import { aiOcr, aiVision } from '@/lib/shared/ai-client'

// The text of an uploaded KYB document: a PDF's own text layer when it has one (the GST portal's certificates do),
// else PaddleOCR through the AI gateway. While PaddleOCR is down, the vision model transcribes instead, unless
// KYB_VISION_FALLBACK=false keeps documents off it (the check then waits for a reviewer).

export interface ReadResult {
  text: string
  source: 'text' | 'ocr'
  engine: 'pdf' | 'paddleocr' | 'vision' | null
  error?: string
}

const TRANSCRIBE =
  'Transcribe every line of text on this document exactly as printed, top to bottom, one line per line. Keep numbers, ' +
  'codes and dates exactly as shown. Output only the text, with no commentary.'

const visionFallback = () => process.env.KYB_VISION_FALLBACK !== 'false'

async function ocr(image: Buffer, mime: 'image/png' | 'image/jpeg'): Promise<{ text: string; engine: 'paddleocr' | 'vision' } | null> {
  const b64 = image.toString('base64')
  const p = await aiOcr(b64, mime)
  if (p.ok && p.text.trim()) return { text: p.text, engine: 'paddleocr' }
  if (!visionFallback()) return null
  const v = await aiVision([b64], TRANSCRIBE, undefined, { feature: 'kyb_check', billing: false, cacheNamespace: 'platform' })
  return v.ok && v.text.trim() ? { text: v.text, engine: 'vision' } : null
}

const legible = (t: string) => t.replace(/\s/g, '').length >= 40

export async function readDocumentText(buf: Buffer, mime: string): Promise<ReadResult> {
  if (mime === 'application/pdf') {
    const layer = await pdfText(buf, 3).catch(() => null)
    if (layer && legible(layer.text)) return { text: layer.text, source: 'text', engine: 'pdf' }
    const parts: string[] = []
    let engine: 'paddleocr' | 'vision' | null = null
    for await (const png of pdfPageImages(buf, { maxPages: 2, scale: 2 })) {
      const r = await ocr(png, 'image/png')
      if (r) {
        parts.push(r.text)
        engine = engine === 'vision' ? 'vision' : r.engine
      }
    }
    return parts.length ? { text: parts.join('\n'), source: 'ocr', engine } : { text: '', source: 'ocr', engine: null, error: 'ocr_unavailable' }
  }
  // Phone photos: upright by their EXIF, no bigger than OCR needs, and JPEG (a photo as PNG can be several times larger).
  const jpeg = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  const r = await ocr(jpeg, 'image/jpeg')
  return r ? { text: r.text, source: 'ocr', engine: r.engine } : { text: '', source: 'ocr', engine: null, error: 'ocr_unavailable' }
}
