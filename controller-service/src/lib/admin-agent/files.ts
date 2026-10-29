import 'server-only'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import { query } from '@/lib/shared/db'
import { ocrImage, ocrPdfPages } from './vision'
import { KIND_BY_MIME, unsupportedMessage } from './file-types'
import { pdfText } from './pdf'

// How an attachment's text is read: PDFs (text layer, else page OCR), images (vision), Word /
// PowerPoint / OpenDocument (their XML), spreadsheets (CSV per sheet) and plain text. Audio and video
// are not read: there is no transcription model.

export type ReadResult =
  | { ok: true; text: string; source: string; pages?: number; model?: string; truncated?: boolean }
  | { ok: false; reason: string; hint?: string }

/** quotation: list the line items (QTY UNIT - DESCRIPTION). general: everything the file says. */
export type ReadPurpose = 'quotation' | 'general'

const MAX_TEXT = 60_000

function done(text: string, source: string, extra: { pages?: number; model?: string } = {}): ReadResult {
  const t = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!t) return { ok: false, reason: 'The file has no readable text' }
  return t.length > MAX_TEXT ? { ok: true, text: t.slice(0, MAX_TEXT), source, truncated: true, ...extra } : { ok: true, text: t, source, ...extra }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function xmlText(xml: string, breaks: RegExp, tabs?: RegExp): string {
  let s = xml.replace(breaks, '\n')
  if (tabs) s = s.replace(tabs, '\t')
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)
    )
}

async function zipEntries(buf: Buffer) {
  const JSZip = (await import('jszip')).default
  return JSZip.loadAsync(buf)
}

async function readDocx(buf: Buffer): Promise<string> {
  const zip = await zipEntries(buf)
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  return xmlText(xml, /<\/w:p>|<w:br\/>|<\/w:tr>/g, /<w:tab\/>|<\/w:tc>/g)
}

async function readPptx(buf: Buffer): Promise<string> {
  const zip = await zipEntries(buf)
  const slides = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const out: string[] = []
  for (const [i, name] of slides.entries()) {
    const xml = (await zip.file(name)!.async('string')) ?? ''
    out.push(`--- Slide ${i + 1} ---\n${xmlText(xml, /<\/a:p>/g)}`)
  }
  return out.join('\n\n')
}

async function readOdf(buf: Buffer): Promise<string> {
  const zip = await zipEntries(buf)
  const xml = (await zip.file('content.xml')?.async('string')) ?? ''
  return xmlText(xml, /<\/text:p>|<\/text:h>|<text:line-break\/>/g, /<text:tab\/>/g)
}

function readSheet(buf: Buffer, mime: string): string {
  const wb = mime.startsWith('text/') ? XLSX.read(buf.toString('utf8'), { type: 'string', FS: mime.includes('tab') ? '\t' : undefined }) : XLSX.read(buf, { type: 'buffer' })
  return wb.SheetNames.map(n => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }).trim()
    return wb.SheetNames.length > 1 ? `--- Sheet: ${n} ---\n${csv}` : csv
  }).join('\n\n')
}

function readText(buf: Buffer, mime: string): string {
  const s = buf.toString('utf8')
  if (mime === 'text/html') return xmlText(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''), /<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, /<\/t[dh]>/gi)
  if (mime.includes('rtf')) return s.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, '')
  return s
}

/** The vision models take JPEG/PNG/WebP/GIF; anything else is converted to PNG first. */
async function visionReady(buf: Buffer, mime: string): Promise<{ ok: true; buf: Buffer } | { ok: false; reason: string; hint?: string }> {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) return { ok: true, buf }
  try {
    return { ok: true, buf: await sharp(buf, { density: 200 }).rotate().png().toBuffer() }
  } catch {
    return { ok: false, reason: `Could not open this ${mime.replace('image/', '').toUpperCase()} image`, hint: 'Save or screenshot it as a JPG or PNG and attach that.' }
  }
}

export async function readAttachment(buf: Buffer, mime: string, purpose: ReadPurpose = 'general'): Promise<ReadResult> {
  const kind = KIND_BY_MIME[mime]
  if (!kind) return { ok: false, reason: unsupportedMessage(mime) }
  try {
    if (kind === 'pdf') {
      let text = ''
      let pages: number | undefined
      try {
        ;({ text, pages } = await pdfText(buf))
      } catch (e) {
        console.error('[agent-files] pdf text', e instanceof Error ? e.message : e)
      }
      // A scan has no text layer (or only a few stray characters): read the pages as images.
      if (text.replace(/\s/g, '').length >= 20) return done(text, 'pdf_text', { pages })
      const v = await ocrPdfPages(buf, { maxPages: 10, purpose })
      return v.ok ? done(v.text, 'vision_ocr', { pages: v.pages, model: v.model }) : v
    }
    if (kind === 'image') {
      const img = await visionReady(buf, mime)
      if (!img.ok) return img
      const v = await ocrImage(img.buf, purpose)
      return v.ok ? done(v.text, 'vision_ocr', { model: v.model }) : v
    }
    if (kind === 'docx') return done(await readDocx(buf), 'docx')
    if (kind === 'pptx') return done(await readPptx(buf), 'pptx')
    if (kind === 'odf') return done(await readOdf(buf), 'opendocument')
    if (kind === 'sheet') return done(readSheet(buf, mime), 'spreadsheet')
    return done(readText(buf, mime), 'text')
  } catch (e) {
    console.error('[agent-files] read failed', mime, e instanceof Error ? e.message : e)
    return { ok: false, reason: `Could not read the file: ${e instanceof Error ? e.message : String(e)}`, hint: 'If it is password-protected or damaged, export it again and re-attach it.' }
  }
}

/**
 * An uploaded attachment's text, cached on its row. A vision read depends on the purpose (line items
 * vs everything), so it is cached per purpose; text read straight from the file serves both.
 */
export async function readStoredAttachment(
  row: { id: string; data: Buffer; mime_type: string; extracted_text: string | null },
  purpose: ReadPurpose
): Promise<ReadResult & { cached?: boolean }> {
  const cached = /^#read:(\w+)\n([\s\S]*)$/.exec(row.extracted_text ?? '')
  if (cached && (cached[1] === 'any' || cached[1] === purpose) && cached[2].trim()) return { ok: true, text: cached[2], source: 'cache', cached: true }
  const r = await readAttachment(row.data, row.mime_type, purpose)
  if (r.ok) {
    const tag = r.source === 'vision_ocr' ? purpose : 'any'
    await query(`UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`, [row.id, `#read:${tag}\n${r.text}`]).catch(() => {})
  }
  return r
}
