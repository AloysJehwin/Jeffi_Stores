import { queryMany } from '@/lib/db'
import path from 'path'

const PDFDocument = eval('require')('pdfkit')

export interface BrochureProductInput {
  id: string
  name: string
  sku: string
  short_description?: string | null
  mrp?: number | null
  base_price?: number | null
  discount_pct?: number | null
  brand_name?: string | null
  category_name?: string | null
  thumbnail_url?: string | null
}

export interface BrochureStore {
  name: string
  address: string
  city: string
  phone: string
  email: string
  gstin: string
  web: string
}

export interface BrochureOptions {
  store: BrochureStore
  title?: string
  showPrices: boolean
}

/** Load store branding from site_settings (mirrors packing-slip-pdf.ts). */
export async function loadBrochureStore(): Promise<BrochureStore> {
  const rows = await queryMany(
    "SELECT key, value FROM site_settings WHERE key LIKE 'business_%'",
    []
  )
  const s: Record<string, string> = {}
  for (const row of (rows || [])) s[row.key] = row.value || ''

  return {
    name: s.business_trade_name || s.business_legal_name || 'JEFFI STORES',
    address: s.business_address || '',
    city: s.business_state || '',
    phone: s.business_phone || '',
    email: s.business_email || '',
    gstin: s.business_gstin || '',
    web: 'jeffistores.in',
  }
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const ML = 36
const MR = 36
const CW = PAGE_W - ML - MR

const GREEN_DARK = '#3d6b00'
const GREEN_MAIN = '#7cb900'
const LIGHT_BG   = '#f4f9ea'
const RULE_COLOR = '#dddddd'
const TEXT_DARK  = '#111111'
const TEXT_MID   = '#444444'
const TEXT_MUTED = '#777777'
const TEXT_LIGHT = '#d4edaa'

const HEADER_H = 84
const FOOTER_H = 30
const ROW_H = 54
const IMG_SIZE = 44
const IMG_CONCURRENCY = 8

function rs(n: number) {
  return 'Rs.' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function box(doc: any, x: number, y: number, w: number, h: number, fill: string) {
  doc.rect(x, y, w, h).fillColor(fill).fill()
}

function hRule(doc: any, x1: number, y: number, x2: number, color = RULE_COLOR, w = 0.5) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke()
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Fetch image buffers in bounded-concurrency chunks so a large selection can't
 *  open thousands of sockets at once. Order is preserved. */
async function prefetchImages(urls: (string | null | undefined)[]): Promise<(Buffer | null)[]> {
  const out: (Buffer | null)[] = new Array(urls.length).fill(null)
  for (let i = 0; i < urls.length; i += IMG_CONCURRENCY) {
    const slice = urls.slice(i, i + IMG_CONCURRENCY)
    const bufs = await Promise.all(
      slice.map(u => (u ? fetchImageBuffer(u) : Promise.resolve(null)))
    )
    bufs.forEach((b, j) => { out[i + j] = b })
  }
  return out
}

function drawHeader(doc: any, store: BrochureStore, title: string) {
  box(doc, 0, 0, PAGE_W, HEADER_H, GREEN_DARK)

  const LOGO_SIZE = 52
  const LOGO_PATH = path.join(process.cwd(), 'public', 'images', 'store-logo.png')
  try {
    doc.image(LOGO_PATH, ML, Math.floor((HEADER_H - LOGO_SIZE) / 2), { width: LOGO_SIZE, height: LOGO_SIZE })
  } catch { /* logo missing — skip */ }

  const textX = ML + LOGO_SIZE + 12
  const textW = CW - LOGO_SIZE - 12
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#ffffff')
  doc.text(store.name.toUpperCase(), textX, 14, { width: textW, lineBreak: false })

  doc.font('Helvetica').fontSize(8).fillColor(TEXT_LIGHT)
  const contactParts = [store.phone && `Ph: ${store.phone}`, store.email, store.web].filter(Boolean)
  if (contactParts.length) {
    doc.text(contactParts.join('  |  '), textX, 38, { width: textW, lineBreak: false })
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
  doc.text(title, textX, 54, { width: textW, lineBreak: false })
}

function drawColumnHeader(doc: any, y: number, showPrices: boolean): number {
  box(doc, ML, y, CW, 18, LIGHT_BG)
  doc.rect(ML, y, CW, 18).lineWidth(0.4).strokeColor(RULE_COLOR).stroke()
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN_DARK)
  doc.text('PRODUCT', ML + IMG_SIZE + 14, y + 6, { lineBreak: false })
  if (showPrices) {
    doc.text('MRP', ML + CW - 150, y + 6, { width: 66, align: 'right', lineBreak: false })
    doc.text('PRICE', ML + CW - 76, y + 6, { width: 68, align: 'right', lineBreak: false })
  }
  return y + 18
}

/**
 * Build a compact product-catalogue brochure PDF.
 * Layout: branded header, column header, then one compact row per product
 * (thumbnail | name + SKU + short description [+ brand/category]) and, when
 * showPrices, an MRP + selling-price column. Multi-page with page numbers.
 */
export async function generateBrochurePDF(
  products: BrochureProductInput[],
  opts: BrochureOptions
): Promise<Buffer> {
  const { store, showPrices } = opts
  const title = (opts.title && opts.title.trim()) || 'Product Brochure'

  const imageBufs = await prefetchImages(products.map(p => p.thumbnail_url))

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  drawHeader(doc, store, title)
  let y = HEADER_H + 12
  y = drawColumnHeader(doc, y, showPrices)

  const bottomLimit = PAGE_H - FOOTER_H - 8
  const priceX = ML + CW - 150
  const nameX = ML + IMG_SIZE + 14
  const nameW = showPrices ? (CW - IMG_SIZE - 14 - 150) : (CW - IMG_SIZE - 20)

  if (products.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(TEXT_MUTED)
    doc.text('No products match this selection.', ML, y + 20, { width: CW, align: 'center' })
  }

  products.forEach((p, idx) => {
    if (y + ROW_H > bottomLimit) {
      doc.addPage({ size: 'A4', margin: 0 })
      drawHeader(doc, store, title)
      y = HEADER_H + 12
      y = drawColumnHeader(doc, y, showPrices)
    }

    // Zebra background for readability
    if (idx % 2 === 1) box(doc, ML, y, CW, ROW_H, '#fafcf5')

    // Thumbnail
    const buf = imageBufs[idx]
    const imgY = y + Math.floor((ROW_H - IMG_SIZE) / 2)
    if (buf) {
      try {
        doc.image(buf, ML + 4, imgY, { width: IMG_SIZE, height: IMG_SIZE, fit: [IMG_SIZE, IMG_SIZE], align: 'center', valign: 'center' })
      } catch {
        doc.rect(ML + 4, imgY, IMG_SIZE, IMG_SIZE).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()
      }
    } else {
      doc.rect(ML + 4, imgY, IMG_SIZE, IMG_SIZE).fillColor('#f0f0f0').fill()
      doc.font('Helvetica').fontSize(6).fillColor('#aaaaaa')
      doc.text('No image', ML + 4, imgY + IMG_SIZE / 2 - 3, { width: IMG_SIZE, align: 'center', lineBreak: false })
    }

    // Name + SKU + description
    let ty = y + 8
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT_DARK)
    doc.text(p.name, nameX, ty, { width: nameW, lineBreak: false, ellipsis: true })
    ty += 13

    const meta = [p.sku && `SKU: ${p.sku}`, p.brand_name, p.category_name].filter(Boolean).join('  •  ')
    if (meta) {
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
      doc.text(meta, nameX, ty, { width: nameW, lineBreak: false, ellipsis: true })
      ty += 11
    }
    if (p.short_description) {
      doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
      doc.text(p.short_description, nameX, ty, { width: nameW, lineBreak: false, ellipsis: true })
    }

    // Prices
    if (showPrices) {
      const price = p.base_price != null ? Number(p.base_price) : null
      const mrp = p.mrp != null ? Number(p.mrp) : null
      const showMrpStrike = mrp != null && price != null && mrp > price
      const py = y + Math.floor(ROW_H / 2) - 6
      doc.font('Helvetica').fontSize(8.5).fillColor(showMrpStrike ? TEXT_MUTED : TEXT_MID)
      doc.text(mrp != null ? rs(mrp) : '—', priceX, py, { width: 66, align: 'right', lineBreak: false })
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN_DARK)
      doc.text(price != null ? rs(price) : (mrp != null ? rs(mrp) : '—'), priceX + 74, py, { width: 68, align: 'right', lineBreak: false })
    }

    hRule(doc, ML, y + ROW_H, ML + CW, RULE_COLOR, 0.4)
    y += ROW_H
  })

  // Footer + page numbers across all buffered pages
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    hRule(doc, ML, PAGE_H - FOOTER_H, ML + CW, GREEN_MAIN, 1)
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
    const foot = [store.name, store.gstin && `GSTIN: ${store.gstin}`].filter(Boolean).join('  |  ')
    doc.text(foot, ML, PAGE_H - FOOTER_H + 8, { width: CW - 80, lineBreak: false })
    doc.text(`Page ${i + 1} of ${range.count}`, ML + CW - 80, PAGE_H - FOOTER_H + 8, { width: 80, align: 'right', lineBreak: false })
  }

  doc.end()
  return done
}
