import 'server-only'
import { queryMany } from '@/lib/shared/db'
import path from 'path'
import fs from 'fs'

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
  promo?: string
  showPrices: boolean
}

/** Load store branding from site_settings (mirrors packing-slip-pdf.ts). */
export async function loadBrochureStore(): Promise<BrochureStore> {
  const rows = await queryMany("SELECT key, value FROM site_settings WHERE key LIKE 'business_%'", [])
  const s: Record<string, string> = {}
  for (const row of rows || []) s[row.key] = row.value || ''

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
const LIGHT_BG = '#f4f9ea'
const RULE_COLOR = '#dddddd'
const TEXT_DARK = '#111111'
const TEXT_MID = '#444444'
const TEXT_MUTED = '#777777'
const TEXT_LIGHT = '#d4edaa'

const HEADER_H = 84
const FOOTER_H = 30
const ROW_H = 60
const ROW_PAD = 8 // inner top/bottom padding within a row
const IMG_SIZE = 44
const QR_SIZE = 40
const GUTTER = 12 // horizontal gap between columns
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

/** Display discount % off MRP (0 when no positive discount). Mirrors mrpDiscountPct. */
function discountPct(mrp: number | null, price: number | null): number {
  if (mrp == null || price == null || mrp <= price || mrp <= 0) return 0
  return Math.round(((mrp - price) / mrp) * 100)
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
  let lo = 0,
    hi = s.length
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
    const bufs = await Promise.all(slice.map(u => (u ? fetchImageBuffer(u) : Promise.resolve(null))))
    bufs.forEach((b, j) => {
      out[i + j] = b
    })
  }
  return out
}

/** Render each product's QR (product URL) up front. null when no slug. */
async function buildQRCodes(products: BrochureProductInput[], web: string): Promise<(Buffer | null)[]> {
  return Promise.all(
    products.map(async p => {
      const url = productUrl(web, p.slug)
      if (!url) return null
      try {
        return await QRCode.toBuffer(url, { type: 'png', width: 120, margin: 0 })
      } catch {
        return null
      }
    })
  )
}

function drawHeader(doc: any, store: BrochureStore, title: string, heading?: string) {
  box(doc, 0, 0, PAGE_W, HEADER_H, GREEN_DARK)

  const LOGO_SIZE = 52
  const LOGO_PATH = path.join(process.cwd(), 'public', 'images', 'store-logo.png')
  try {
    doc.image(LOGO_PATH, ML, Math.floor((HEADER_H - LOGO_SIZE) / 2), { width: LOGO_SIZE, height: LOGO_SIZE })
  } catch {
    /* logo missing — skip */
  }

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
    doc.text(clip1(doc, heading.toUpperCase(), 130), textX + textW - 130, 55, {
      width: 130,
      align: 'right',
      lineBreak: false,
    })
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
  // Remove size tokens from ANYWHERE (real names embed the size mid-string,
  // e.g. `BSW 1/2" SS 202 Allen Cap Screw`). Leaves grade/material numbers
  // like 202 / 304 / 12.9 intact — only sized tokens are stripped.
  const sizeTokens = [
    /\bM\d+(?:\.\d+)?\b/gi, // M6, M12
    /\b\d+\/\d+\s*["'”]?/g, // 1/2", 3/16
    /\b\d+(?:\.\d+)?\s*(?:mm|cm|inch|in)\b/gi, // 25mm, 3 in
    /\b\d+(?:\.\d+)?\s*["'”]/g, // 2"
    /\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\b/gi, // 5x40
  ]
  for (const re of sizeTokens) s = s.replace(re, ' ')
  const key = s.toLowerCase().replace(/\s+/g, ' ').trim()
  return key || (name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Levenshtein distance (iterative, two-row). */
function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/** Name similarity in [0,1] (1 = identical) on normalized strings. */
export function nameSimilarity(a: string, b: string): number {
  const x = (a ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const y = (b ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const L = Math.max(x.length, y.length)
  return L === 0 ? 1 : 1 - levenshtein(x, y) / L
}

const FAMILY_SIMILARITY_THRESHOLD = 0.82

/**
 * Two products are the same family iff their names are highly similar
 * (fuzzy ratio ≥ threshold) AND their ONLY difference is size — i.e. once size
 * tokens are stripped the remainders are identical. This keeps "…Cap Screw" and
 * "…CSK Screw" (or Steel vs Brass) as separate families even when very similar,
 * while collapsing M5/M8/… or 1/2"/3/8" sizes of the same product.
 */
export function sameFamily(a: string, b: string): boolean {
  if (familyKey(a) !== familyKey(b)) return false // size-only-diff gate
  return nameSimilarity(a, b) >= FAMILY_SIMILARITY_THRESHOLD // similarity confirm
}

/**
 * Split products into one representative per family (first seen) + the rest.
 * A product joins an existing family when sameFamily() holds against that
 * family's representative; otherwise it starts a new family.
 */
export function splitFamilies(products: BrochureProductInput[]): {
  representatives: BrochureProductInput[]
  rest: BrochureProductInput[]
} {
  const representatives: BrochureProductInput[] = []
  const rest: BrochureProductInput[] = []
  // Bucket by familyKey first (fast), then confirm with the similarity gate so
  // near-key-collisions across different products don't wrongly merge.
  const repByKey = new Map<string, BrochureProductInput[]>()
  for (const p of products) {
    const key = familyKey(p.name)
    const bucket = repByKey.get(key)
    const match = bucket?.find(r => sameFamily(r.name, p.name))
    if (match) {
      rest.push(p)
    } else {
      representatives.push(p)
      if (bucket) bucket.push(p)
      else repByKey.set(key, [p])
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
export async function generateBrochurePDF(products: BrochureProductInput[], opts: BrochureOptions): Promise<Buffer> {
  const { store, showPrices } = opts
  const title = (opts.title && opts.title.trim()) || 'Product Brochure'
  const promo = (opts.promo && opts.promo.trim()) || ''

  const [imageBufs, qrBufs] = await Promise.all([
    prefetchImages(products.map(p => p.thumbnail_url)),
    buildQRCodes(products, store.web),
  ])
  const hasQR = qrBufs.some(Boolean)
  const imgById = new Map<string, Buffer | null>()
  const qrById = new Map<string, Buffer | null>()
  products.forEach((p, i) => {
    imgById.set(p.id, imageBufs[i])
    qrById.set(p.id, qrBufs[i])
  })

  const { representatives, rest } = splitFamilies(products)
  const coverImg = loadCoverImage()

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>(resolve => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const perPage = MATRIX_COLS * MATRIX_ROWS
  const matrixPages = Math.ceil(representatives.length / perPage)
  // Page numbering: 1 = cover, 2 = index, matrix starts at 3.
  const FIRST_CONTENT_PAGE = 3
  // Index entries: each family representative → the matrix page it lands on.
  const familyPages = representatives.map((p, i) => ({
    name: p.name,
    page: FIRST_CONTENT_PAGE + Math.floor(i / perPage),
  }))

  let pageStarted = false
  const newPage = (heading: string) => {
    if (pageStarted) doc.addPage({ size: 'A4', margin: 0 })
    pageStarted = true
    drawHeader(doc, store, title, heading)
    return HEADER_H + 14
  }

  // ── Page 1: advertising cover ──
  drawCover(doc, store, title, promo, coverImg)
  pageStarted = true

  // ── Page 2: index (families → page numbers) ──
  doc.addPage({ size: 'A4', margin: 0 })
  drawIndex(doc, store, title, familyPages, rest.length > 0)

  if (products.length === 0) {
    newPage('')
    doc.font('Helvetica').fontSize(11).fillColor(TEXT_MUTED)
    doc.text('No products match this selection.', ML, HEADER_H + 40, { width: CW, align: 'center' })
  }

  // ── Featured matrix (3×3) of family representatives ──
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

  // Footer + page numbers across all buffered pages EXCEPT the cover (page 0).
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    if (i === range.start) continue // cover has its own full-bleed layout
    doc.switchToPage(i)
    hRule(doc, ML, PAGE_H - FOOTER_H, ML + CW, GREEN_MAIN, 1)
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
    const foot = [store.name, store.gstin && `GSTIN: ${store.gstin}`].filter(Boolean).join('  |  ')
    doc.text(clip1(doc, foot, CW - 90), ML, PAGE_H - FOOTER_H + 8, { width: CW - 90, lineBreak: false })
    doc.text(`Page ${i + 1} of ${range.count}`, ML + CW - 90, PAGE_H - FOOTER_H + 8, {
      width: 90,
      align: 'right',
      lineBreak: false,
    })
  }

  doc.end()
  return done
}

/** Cover background image, if a curated one has been dropped in public/images. */
function loadCoverImage(): string | null {
  const candidates = ['brochure-cover.png', 'brochure-cover.jpg', 'brochure-cover.jpeg']
  for (const f of candidates) {
    const p = path.join(process.cwd(), 'public', 'images', f)
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Page 1 — advertising cover. Uses public/images/brochure-cover.* as a full-bleed
 * hero if present; otherwise paints a branded green gradient. Overlaid: logo,
 * store name, brochure title, optional promo line, contact/GST, generated date.
 */
function drawCover(doc: any, store: BrochureStore, title: string, promo: string, coverImg: string | null) {
  // Background
  if (coverImg) {
    try {
      doc.image(coverImg, 0, 0, { width: PAGE_W, height: PAGE_H, align: 'center', valign: 'center' })
    } catch {
      paintGradient(doc)
    }
  } else {
    paintGradient(doc)
  }
  // Dark scrim so overlay text is legible on any image
  doc.save()
  doc
    .rect(0, 0, PAGE_W, PAGE_H)
    .fillColor('#000000')
    .opacity(coverImg ? 0.38 : 0.12)
    .fill()
  doc.restore()

  const cx = PAGE_W / 2
  // Logo (centered, upper third)
  const LOGO = 96
  const logoPath = path.join(process.cwd(), 'public', 'images', 'store-logo.png')
  try {
    doc.image(logoPath, cx - LOGO / 2, 150, { width: LOGO, height: LOGO })
  } catch {
    /* skip */
  }

  doc.fillColor('#ffffff')
  doc.font('Helvetica-Bold').fontSize(30)
  doc.text(store.name.toUpperCase(), ML, 270, { width: CW, align: 'center' })

  // Accent rule
  doc
    .moveTo(cx - 60, 312)
    .lineTo(cx + 60, 312)
    .lineWidth(2)
    .strokeColor(GREEN_MAIN)
    .stroke()

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff')
  doc.text(title, ML, 330, { width: CW, align: 'center' })

  if (promo) {
    doc.font('Helvetica-Oblique').fontSize(13).fillColor('#eaffd0')
    doc.text(promo, ML + 40, 366, { width: CW - 80, align: 'center' })
  }

  // Contact block near bottom
  const contact = [
    [store.address, store.city].filter(Boolean).join(', '),
    [store.phone && `Ph: ${store.phone}`, store.email].filter(Boolean).join('   |   '),
    [store.web, store.gstin && `GSTIN: ${store.gstin}`].filter(Boolean).join('   |   '),
  ].filter(Boolean)
  doc.font('Helvetica').fontSize(10).fillColor('#ffffff')
  let cyc = PAGE_H - 150
  for (const line of contact) {
    doc.text(line, ML, cyc, { width: CW, align: 'center' })
    cyc += 15
  }
  doc.font('Helvetica').fontSize(8).fillColor('#dfeecb')
  doc.text('Product Catalogue', ML, PAGE_H - 70, { width: CW, align: 'center' })
}

function paintGradient(doc: any) {
  // Simple vertical two-tone band as a dependency-free "gradient".
  const bands = 60
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    const c = mixHex('#2c5200', '#7cb900', t)
    doc
      .rect(0, (PAGE_H / bands) * i, PAGE_W, PAGE_H / bands + 1)
      .fillColor(c)
      .fill()
  }
}

function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return '#' + mix.map(v => v.toString(16).padStart(2, '0')).join('')
}

/** Page 2 — index: each family representative → its page number. */
function drawIndex(
  doc: any,
  store: BrochureStore,
  title: string,
  familyPages: { name: string; page: number }[],
  hasList: boolean
) {
  drawHeader(doc, store, title, 'Index')
  let y = HEADER_H + 24
  doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN_DARK)
  doc.text('Index', ML, y, { lineBreak: false })
  y += 24

  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED)
  doc.text('FEATURED PRODUCTS', ML, y, { lineBreak: false })
  y += 16

  const bottomLimit = PAGE_H - FOOTER_H - 8
  const dotStartPad = 6
  for (const { name, page } of familyPages) {
    if (y + 16 > bottomLimit) {
      doc.addPage({ size: 'A4', margin: 0 })
      drawHeader(doc, store, title, 'Index')
      y = HEADER_H + 24
    }
    doc.font('Helvetica').fontSize(9.5).fillColor(TEXT_DARK)
    const nameMax = CW - 40
    const label = clip1(doc, name, nameMax - 30)
    const labelW = doc.widthOfString(label)
    doc.text(label, ML, y, { lineBreak: false })
    // leader dots
    const pageStr = String(page)
    doc.font('Helvetica').fontSize(9.5).fillColor(GREEN_DARK)
    const pageW = doc.widthOfString(pageStr)
    doc.font('Helvetica').fontSize(8).fillColor('#bbbbbb')
    const dotsX1 = ML + labelW + dotStartPad
    const dotsX2 = ML + CW - pageW - dotStartPad
    if (dotsX2 > dotsX1) {
      let dx = dotsX1
      const dots: string[] = []
      const dotW = doc.widthOfString('.')
      while (dx < dotsX2) {
        dots.push('.')
        dx += dotW
      }
      doc.text(dots.join(''), dotsX1, y + 1, { lineBreak: false })
    }
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN_DARK)
    doc.text(pageStr, ML + CW - pageW, y, { lineBreak: false })
    y += 16
  }

  if (hasList) {
    y += 8
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(TEXT_MUTED)
    doc.text('Additional sizes & variants are listed under "More Products".', ML, y, { width: CW, lineBreak: false })
  }
}

/** One compact list row (used for the non-representative products). */
function drawListRow(
  doc: any,
  p: BrochureProductInput,
  y: number,
  idx: number,
  buf: Buffer | null,
  qr: Buffer | null,
  showPrices: boolean,
  hasQR: boolean
) {
  if (idx % 2 === 1) box(doc, ML, y, CW, ROW_H, '#fafcf5')

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

  const priceColX = hasQR ? PRICE_X_WITH_QR : PRICE_X_NO_QR
  const nameRightEdge = showPrices ? priceColX : hasQR ? QR_X : ML + CW - 6
  const nameW = nameRightEdge - GUTTER - NAME_X

  const nameGap = 13
  const metaText = [p.sku && `SKU: ${p.sku}`, p.brand_name, p.category_name].filter(Boolean).join('  •  ')
  const hasMeta = metaText.length > 0
  const hasDesc = !!p.short_description
  const blockH = nameGap + (hasMeta ? 11 : 0) + (hasDesc ? 11 : 0)
  let ty = y + Math.round((ROW_H - blockH) / 2)

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT_DARK)
  doc.text(clip1(doc, p.name, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
  ty += nameGap
  if (hasMeta) {
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
    doc.text(clip1(doc, metaText, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
    ty += 11
  }
  if (hasDesc) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
    doc.text(clip1(doc, p.short_description!, nameW), NAME_X, ty, { width: nameW, lineBreak: false })
  }

  if (showPrices) {
    const price = p.base_price != null ? Number(p.base_price) : null
    const mrp = p.mrp != null ? Number(p.mrp) : null
    const showMrpStrike = mrp != null && price != null && mrp > price
    const off = discountPct(mrp, price)
    const stackH = showMrpStrike ? 22 : 12
    let py = y + Math.round((ROW_H - stackH) / 2)
    if (showMrpStrike) {
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
      doc.text(rs(mrp!), priceColX, py, { width: PRICE_W, align: 'right', lineBreak: false })
      py += 11
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN_DARK)
    doc.text(price != null ? rs(price) : mrp != null ? rs(mrp) : '—', priceColX, py, {
      width: PRICE_W,
      align: 'right',
      lineBreak: false,
    })
    if (off > 0) {
      // small "N% OFF" badge to the left of the price column
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#c0392b')
      doc.text(`${off}% OFF`, priceColX - 54, py + 1, { width: 50, align: 'right', lineBreak: false })
    }
  }

  if (hasQR && qr) {
    const qy = y + Math.round((ROW_H - QR_SIZE) / 2)
    try {
      doc.image(qr, QR_X, qy, { width: QR_SIZE, height: QR_SIZE })
    } catch {
      /* skip */
    }
  }

  hRule(doc, ML, y + ROW_H, ML + CW, RULE_COLOR, 0.4)
}

/** One featured matrix tile: bordered card with big image, name, price, QR. */
function drawTile(
  doc: any,
  p: BrochureProductInput,
  x: number,
  y: number,
  buf: Buffer | null,
  qr: Buffer | null,
  showPrices: boolean,
  hasQR: boolean
) {
  // Card
  doc.roundedRect(x, y, TILE_W, TILE_H, 6).lineWidth(0.6).strokeColor(RULE_COLOR).stroke()

  const pad = 8
  const innerW = TILE_W - pad * 2
  const imgBox = TILE_W - pad * 2 // square image area spanning inner width
  const imgH = Math.min(imgBox, 96)
  const imgY = y + pad

  if (buf) {
    try {
      doc.image(buf, x + pad, imgY, { fit: [innerW, imgH], align: 'center', valign: 'center' })
    } catch {
      doc
        .rect(x + pad, imgY, innerW, imgH)
        .lineWidth(0.4)
        .strokeColor(RULE_COLOR)
        .stroke()
    }
  } else {
    doc
      .rect(x + pad, imgY, innerW, imgH)
      .fillColor('#f4f4f4')
      .fill()
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
    try {
      doc.image(qr, x + TILE_W - pad - QR_SIZE, stripY, { width: QR_SIZE, height: QR_SIZE })
    } catch {
      /* skip */
    }
  }
  if (showPrices) {
    const price = p.base_price != null ? Number(p.base_price) : null
    const mrp = p.mrp != null ? Number(p.mrp) : null
    const showMrpStrike = mrp != null && price != null && mrp > price
    const off = discountPct(mrp, price)
    const priceMaxW = innerW - (hasQR ? QR_SIZE + 6 : 0)
    let py = stripY + (showMrpStrike ? 4 : 12)
    if (showMrpStrike) {
      doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED)
      doc.text(rs(mrp!), x + pad, py, { width: priceMaxW, lineBreak: false })
      if (off > 0) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#c0392b')
        doc.text(`${off}% OFF`, x + pad, py, { width: priceMaxW, align: 'right', lineBreak: false })
      }
      py += 11
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN_DARK)
    doc.text(price != null ? rs(price) : mrp != null ? rs(mrp) : '—', x + pad, py, {
      width: priceMaxW,
      lineBreak: false,
    })
  }
}
