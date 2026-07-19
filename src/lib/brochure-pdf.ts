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

// Featured 3×3 matrix geometry
const MATRIX_COLS = 3
const MATRIX_ROWS = 3
const TILE_GAP = 12
const TILE_W = Math.floor((CW - TILE_GAP * (MATRIX_COLS - 1)) / MATRIX_COLS)
// Rows must fit under the header down to the footer.
const MATRIX_TOP = HEADER_H + 14
const TILE_H = Math.floor((PAGE_H - FOOTER_H - 8 - MATRIX_TOP - TILE_GAP * (MATRIX_ROWS - 1)) / MATRIX_ROWS)

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

function drawHeader(doc: any, store: BrochureStore, title: string, heading?: string) {
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
  // Line 3: brochure title (left) + section heading pill (right)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
  doc.text(clip1(doc, title, textW - 130), textX, 54, { width: textW - 130, lineBreak: false })
  if (heading) {
    doc.font('Helvetica').fontSize(8.5).fillColor(TEXT_LIGHT)
    doc.text(clip1(doc, heading.toUpperCase(), 130), textX + textW - 130, 55, { width: 130, align: 'right', lineBreak: false })
  }
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
 * Family key = product name with the trailing size token removed, so
 * "…Screw Metric 12.9 M5" and "…M12" collapse to one family. Strips common
 * size patterns (M6, 25mm, 1/2", 3x40, trailing bare number). Case/space
 * normalized. Falls back to the full normalized name when nothing strips.
 */
export function familyKey(name: string): string {
  let s = (name ?? '').trim()
  // Remove one or more trailing size-ish tokens, repeatedly.
  const sizePattern = /[\s,\-x×]*\b(?:M\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?mm|\d+\/\d+"?|\d+(?:\.\d+)?["']|\d+(?:\.\d+)?\s?x\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*$/i
  let prev: string
  do {
    prev = s
    s = s.replace(sizePattern, '').trim()
  } while (s !== prev && s.length > 0)
  const key = (s || name || '').toLowerCase().replace(/\s+/g, ' ').trim()
  return key
}

/** Split products into one representative per family (first seen) + the rest. */
export function splitFamilies(products: BrochureProductInput[]): {
  representatives: BrochureProductInput[]
  rest: BrochureProductInput[]
} {
  const seen = new Set<string>()
  const representatives: BrochureProductInput[] = []
  const rest: BrochureProductInput[] = []
  for (const p of products) {
    const key = familyKey(p.name)
    if (seen.has(key)) {
      rest.push(p)
    } else {
      seen.add(key)
      representatives.push(p)
    }
  }
  return { representatives, rest }
}

/**
 * Build a product-catalogue brochure PDF.
 *   • First pages: a 3×3 matrix (9/page) of ONE representative per product
 *     family (name with size stripped) — image-forward tiles.
 *   • Then: every remaining product (other sizes/SKUs) in compact list rows.
 * Shared branded header/footer + page numbers; QR per product → product page.
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
  // Look up prefetched buffers by product id (matrix + list share these).
  const imgById = new Map<string, Buffer | null>()
  const qrById = new Map<string, Buffer | null>()
  products.forEach((p, i) => { imgById.set(p.id, imageBufs[i]); qrById.set(p.id, qrBufs[i]) })

  const { representatives, rest } = splitFamilies(products)

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  let pageStarted = false
  const newPage = (heading: string) => {
    if (pageStarted) doc.addPage({ size: 'A4', margin: 0 })
    pageStarted = true
    drawHeader(doc, store, title, heading)
    return HEADER_H + 14
  }

  if (products.length === 0) {
    newPage('')
    doc.font('Helvetica').fontSize(11).fillColor(TEXT_MUTED)
    doc.text('No products match this selection.', ML, HEADER_H + 40, { width: CW, align: 'center' })
  }

  // ── Featured matrix (3×3) of family representatives ──
  const perPage = MATRIX_COLS * MATRIX_ROWS
  for (let i = 0; i < representatives.length; i += perPage) {
    const top = newPage('Featured Products')
    const pageItems = representatives.slice(i, i + perPage)
    pageItems.forEach((p, k) => {
      const col = k % MATRIX_COLS
      const row = Math.floor(k / MATRIX_COLS)
      const x = ML + col * (TILE_W + TILE_GAP)
      const cellY = top + row * (TILE_H + TILE_GAP)
      drawTile(doc, p, x, cellY, imgById.get(p.id) ?? null, qrById.get(p.id) ?? null, showPrices, hasQR)
    })
  }

  // ── Remaining products in compact list rows ──
  if (rest.length > 0) {
    let y = newPage(representatives.length > 0 ? 'More Products' : 'Products')
    y = drawColumnHeader(doc, y, showPrices, hasQR)
    const bottomLimit = PAGE_H - FOOTER_H - 8
    rest.forEach((p, idx) => {
      if (y + ROW_H > bottomLimit) {
        y = newPage('More Products')
        y = drawColumnHeader(doc, y, showPrices, hasQR)
      }
      drawListRow(doc, p, y, idx, imgById.get(p.id) ?? null, qrById.get(p.id) ?? null, showPrices, hasQR)
      y += ROW_H
    })
  }

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

/** One compact list row (used for the non-representative products). */
function drawListRow(
  doc: any, p: BrochureProductInput, y: number, idx: number,
  buf: Buffer | null, qr: Buffer | null, showPrices: boolean, hasQR: boolean
) {
  if (idx % 2 === 1) box(doc, ML, y, CW, ROW_H, '#fafcf5')

  const imgY = y + Math.round((ROW_H - IMG_SIZE) / 2)
  if (buf) {
    try { doc.image(buf, IMG_X, imgY, { fit: [IMG_SIZE, IMG_SIZE], align: 'center', valign: 'center' }) }
    catch { doc.rect(IMG_X, imgY, IMG_SIZE, IMG_SIZE).lineWidth(0.5).strokeColor(RULE_COLOR).stroke() }
  } else {
    doc.rect(IMG_X, imgY, IMG_SIZE, IMG_SIZE).fillColor('#f0f0f0').fill()
    doc.font('Helvetica').fontSize(6).fillColor('#aaaaaa')
    doc.text('No image', IMG_X, imgY + IMG_SIZE / 2 - 3, { width: IMG_SIZE, align: 'center', lineBreak: false })
  }

  const priceColX = hasQR ? PRICE_X_WITH_QR : PRICE_X_NO_QR
  const nameRightEdge = showPrices ? priceColX : (hasQR ? QR_X : (ML + CW - 6))
  const nameW = nameRightEdge - GUTTER - NAME_X

  const nameGap = 13
  const metaText = [p.sku && `SKU: ${p.sku}`, p.brand_name, p.category_name].filter(Boolean).join('  •  ')
  const hasMeta = metaText.length > 0
  const hasDesc = !!p.short_description
  const blockH = nameGap + (hasMeta ? 11 : 0) + (hasDesc ? 11 : 0)
  let ty = y + Math.round((ROW_H - blockH) / 2)

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT_DARK)
  doc.text(clip1(doc, p.name, nameW), NAME_X, ty, { width: nameW, lineBreak: false }); ty += nameGap
  if (hasMeta) {
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
    doc.text(clip1(doc, metaText, nameW), NAME_X, ty, { width: nameW, lineBreak: false }); ty += 11
  }
  if (hasDesc) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
    doc.text(clip1(doc, p.short_description!, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
  }

  if (showPrices) {
    const price = p.base_price != null ? Number(p.base_price) : null
    const mrp = p.mrp != null ? Number(p.mrp) : null
    const showMrpStrike = mrp != null && price != null && mrp > price
    const stackH = showMrpStrike ? 22 : 12
    let py = y + Math.round((ROW_H - stackH) / 2)
    if (showMrpStrike) {
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
      doc.text(rs(mrp!), priceColX, py, { width: PRICE_W, align: 'right', lineBreak: false }); py += 11
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN_DARK)
    doc.text(price != null ? rs(price) : (mrp != null ? rs(mrp) : '—'), priceColX, py, { width: PRICE_W, align: 'right', lineBreak: false })
  }

  if (hasQR && qr) {
    const qy = y + Math.round((ROW_H - QR_SIZE) / 2)
    try { doc.image(qr, QR_X, qy, { width: QR_SIZE, height: QR_SIZE }) } catch { /* skip */ }
  }

  hRule(doc, ML, y + ROW_H, ML + CW, RULE_COLOR, 0.4)
}

/** One featured matrix tile: bordered card with big image, name, price, QR. */
function drawTile(
  doc: any, p: BrochureProductInput, x: number, y: number,
  buf: Buffer | null, qr: Buffer | null, showPrices: boolean, hasQR: boolean
) {
  // Card
  doc.roundedRect(x, y, TILE_W, TILE_H, 6).lineWidth(0.6).strokeColor(RULE_COLOR).stroke()

  const pad = 8
  const innerW = TILE_W - pad * 2
  const imgBox = TILE_W - pad * 2           // square image area spanning inner width
  const imgH = Math.min(imgBox, 96)
  const imgY = y + pad

  if (buf) {
    try { doc.image(buf, x + pad, imgY, { fit: [innerW, imgH], align: 'center', valign: 'center' }) }
    catch { doc.rect(x + pad, imgY, innerW, imgH).lineWidth(0.4).strokeColor(RULE_COLOR).stroke() }
  } else {
    doc.rect(x + pad, imgY, innerW, imgH).fillColor('#f4f4f4').fill()
    doc.font('Helvetica').fontSize(7).fillColor('#aaaaaa')
    doc.text('No image', x + pad, imgY + imgH / 2 - 4, { width: innerW, align: 'center', lineBreak: false })
  }

  let ty = imgY + imgH + 7
  // Name (up to two clipped lines)
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK)
  const line1 = clip1(doc, p.name, innerW)
  doc.text(line1, x + pad, ty, { width: innerW, lineBreak: false })
  ty += 11

  // SKU line
  if (p.sku) {
    doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED)
    doc.text(clip1(doc, `SKU: ${p.sku}`, innerW), x + pad, ty, { width: innerW, lineBreak: false })
    ty += 10
  }

  // Bottom strip: price (left) + QR (right)
  const stripY = y + TILE_H - pad - QR_SIZE
  if (hasQR && qr) {
    try { doc.image(qr, x + TILE_W - pad - QR_SIZE, stripY, { width: QR_SIZE, height: QR_SIZE }) } catch { /* skip */ }
  }
  if (showPrices) {
    const price = p.base_price != null ? Number(p.base_price) : null
    const mrp = p.mrp != null ? Number(p.mrp) : null
    const showMrpStrike = mrp != null && price != null && mrp > price
    const priceMaxW = innerW - (hasQR ? QR_SIZE + 6 : 0)
    let py = stripY + (showMrpStrike ? 4 : 12)
    if (showMrpStrike) {
      doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED)
      doc.text(rs(mrp!), x + pad, py, { width: priceMaxW, lineBreak: false }); py += 11
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN_DARK)
    doc.text(price != null ? rs(price) : (mrp != null ? rs(mrp) : '—'), x + pad, py, { width: priceMaxW, lineBreak: false })
  }
}
