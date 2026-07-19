import { queryMany } from '@/lib/db'
import path from 'path'

const PDFDocument = eval('require')('pdfkit')
const QRCode = eval('require')('qrcode')

export interface BrochureProductInput {
  id: string
  name: string
  slug?: string | null
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

/** Public product URL a brochure QR resolves to (with a brochure source tag). */
export function productUrl(web: string, slug?: string | null): string | null {
  if (!slug) return null
  const host = web.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${host}/products/${slug}?src=brochure`
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
const ROW_H = 60
const ROW_PAD = 8              // inner top/bottom padding within a row
const IMG_SIZE = 44
const QR_SIZE = 40
const GUTTER = 12              // horizontal gap between columns
const IMG_CONCURRENCY = 8

// Column geometry (left → right): [image] [name block] [price] [qr]
const IMG_X = ML + 6
const NAME_X = IMG_X + IMG_SIZE + GUTTER
const QR_X = ML + CW - 6 - QR_SIZE
const PRICE_W = 84
const PRICE_X_WITH_QR = QR_X - GUTTER - PRICE_W
const PRICE_X_NO_QR = ML + CW - 6 - PRICE_W

function rs(n: number) {
  return 'Rs.' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Truncate a string with an ellipsis so it fits on ONE line at the doc's current
 * font/size within maxW. pdfkit's `ellipsis`/`lineBreak:false` still wraps some
 * strings, so we measure and cut explicitly. Call AFTER setting doc.font/fontSize.
 */
function clip1(doc: any, text: string, maxW: number): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (doc.widthOfString(s) <= maxW) return s
  const ell = '…'
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (doc.widthOfString(s.slice(0, mid) + ell) <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? s.slice(0, lo) + ell : ell
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

/** Render each product's QR (product URL) up front. null when no slug. */
async function buildQRCodes(products: BrochureProductInput[], web: string): Promise<(Buffer | null)[]> {
  return Promise.all(products.map(async p => {
    const url = productUrl(web, p.slug)
    if (!url) return null
    try {
      return await QRCode.toBuffer(url, { type: 'png', width: 120, margin: 0 })
    } catch {
      return null
    }
  }))
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
  doc.text(clip1(doc, store.name.toUpperCase(), textW), textX, 14, { width: textW, lineBreak: false })

  doc.font('Helvetica').fontSize(8).fillColor(TEXT_LIGHT)
  const contactParts = [store.phone && `Ph: ${store.phone}`, store.email, store.web].filter(Boolean)
  if (contactParts.length) {
    doc.text(clip1(doc, contactParts.join('  |  '), textW), textX, 38, { width: textW, lineBreak: false })
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
  doc.text(clip1(doc, title, textW), textX, 54, { width: textW, lineBreak: false })
}

function drawColumnHeader(doc: any, y: number, showPrices: boolean, hasQR: boolean): number {
  const H = 18
  box(doc, ML, y, CW, H, LIGHT_BG)
  doc.rect(ML, y, CW, H).lineWidth(0.4).strokeColor(RULE_COLOR).stroke()
  const ty = y + 5.5
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN_DARK)
  doc.text('PRODUCT', NAME_X, ty, { lineBreak: false })
  if (showPrices) {
    const px = hasQR ? PRICE_X_WITH_QR : PRICE_X_NO_QR
    doc.text('PRICE', px, ty, { width: PRICE_W, align: 'right', lineBreak: false })
  }
  if (hasQR) {
    doc.text('SCAN', QR_X, ty, { width: QR_SIZE, align: 'center', lineBreak: false })
  }
  return y + H
}

/**
 * Build a compact product-catalogue brochure PDF.
 * Layout per row: [thumbnail] [name + SKU + brand/category + short description]
 * [price column, when showPrices] [QR to the product page, when a slug exists].
 * All columns share a fixed grid so rows line up; multi-page with page numbers.
 */
export async function generateBrochurePDF(
  products: BrochureProductInput[],
  opts: BrochureOptions
): Promise<Buffer> {
  const { store, showPrices } = opts
  const title = (opts.title && opts.title.trim()) || 'Product Brochure'

  const [imageBufs, qrBufs] = await Promise.all([
    prefetchImages(products.map(p => p.thumbnail_url)),
    buildQRCodes(products, store.web),
  ])
  const hasQR = qrBufs.some(Boolean)

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  drawHeader(doc, store, title)
  let y = HEADER_H + 12
  y = drawColumnHeader(doc, y, showPrices, hasQR)

  const bottomLimit = PAGE_H - FOOTER_H - 8
  const priceColX = hasQR ? PRICE_X_WITH_QR : PRICE_X_NO_QR
  // Name block runs from NAME_X up to the left edge of whichever column follows.
  const nameRightEdge = showPrices ? priceColX : (hasQR ? QR_X : (ML + CW - 6))
  const nameW = nameRightEdge - GUTTER - NAME_X

  if (products.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(TEXT_MUTED)
    doc.text('No products match this selection.', ML, y + 20, { width: CW, align: 'center' })
  }

  products.forEach((p, idx) => {
    if (y + ROW_H > bottomLimit) {
      doc.addPage({ size: 'A4', margin: 0 })
      drawHeader(doc, store, title)
      y = HEADER_H + 12
      y = drawColumnHeader(doc, y, showPrices, hasQR)
    }

    // Zebra background for readability
    if (idx % 2 === 1) box(doc, ML, y, CW, ROW_H, '#fafcf5')

    // ── Thumbnail (vertically centered) ──
    const buf = imageBufs[idx]
    const imgY = y + Math.round((ROW_H - IMG_SIZE) / 2)
    if (buf) {
      try {
        doc.image(buf, IMG_X, imgY, { fit: [IMG_SIZE, IMG_SIZE], align: 'center', valign: 'center' })
      } catch {
        doc.rect(IMG_X, imgY, IMG_SIZE, IMG_SIZE).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()
      }
    } else {
      doc.rect(IMG_X, imgY, IMG_SIZE, IMG_SIZE).fillColor('#f0f0f0').fill()
      doc.font('Helvetica').fontSize(6).fillColor('#aaaaaa')
      doc.text('No image', IMG_X, imgY + IMG_SIZE / 2 - 3, { width: IMG_SIZE, align: 'center', lineBreak: false })
    }

    // ── Name block: measure the three lines and vertically center them ──
    const nameLine = { font: 'Helvetica-Bold', size: 9.5, gap: 13 }
    const metaText = [p.sku && `SKU: ${p.sku}`, p.brand_name, p.category_name].filter(Boolean).join('  •  ')
    const hasMeta = metaText.length > 0
    const hasDesc = !!p.short_description
    const blockH = nameLine.gap + (hasMeta ? 11 : 0) + (hasDesc ? 11 : 0)
    let ty = y + Math.round((ROW_H - blockH) / 2)

    doc.font(nameLine.font).fontSize(nameLine.size).fillColor(TEXT_DARK)
    doc.text(clip1(doc, p.name, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
    ty += nameLine.gap

    if (hasMeta) {
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
      doc.text(clip1(doc, metaText, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
      ty += 11
    }
    if (hasDesc) {
      doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
      doc.text(clip1(doc, p.short_description!, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
    }

    // ── Price column (right-aligned, vertically centered) ──
    if (showPrices) {
      const price = p.base_price != null ? Number(p.base_price) : null
      const mrp = p.mrp != null ? Number(p.mrp) : null
      const showMrpStrike = mrp != null && price != null && mrp > price
      // Center the (optional MRP + price) pair as a two-line stack
      const stackH = showMrpStrike ? 22 : 12
      let py = y + Math.round((ROW_H - stackH) / 2)
      if (showMrpStrike) {
        doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
        doc.text(rs(mrp!), priceColX, py, { width: PRICE_W, align: 'right', lineBreak: false })
        py += 11
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN_DARK)
      const value = price != null ? rs(price) : (mrp != null ? rs(mrp) : '—')
      doc.text(value, priceColX, py, { width: PRICE_W, align: 'right', lineBreak: false })
    }

    // ── QR (vertically centered) ──
    const qr = qrBufs[idx]
    if (hasQR) {
      const qy = y + Math.round((ROW_H - QR_SIZE) / 2)
      if (qr) {
        try { doc.image(qr, QR_X, qy, { width: QR_SIZE, height: QR_SIZE }) } catch { /* skip */ }
      }
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
    doc.text(clip1(doc, foot, CW - 90), ML, PAGE_H - FOOTER_H + 8, { width: CW - 90, lineBreak: false })
    doc.text(`Page ${i + 1} of ${range.count}`, ML + CW - 90, PAGE_H - FOOTER_H + 8, { width: 90, align: 'right', lineBreak: false })
  }

  doc.end()
  return done
}
