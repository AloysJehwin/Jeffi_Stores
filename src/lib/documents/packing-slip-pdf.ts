import 'server-only'
import { queryMany } from '@/lib/shared/db'
import path from 'path'

const PDFDocument = eval('require')('pdfkit')
const QRCode = eval('require')('qrcode')
const bwipjs = eval('require')('bwip-js')

export interface PackingSlipItem {
  product_name: string
  variant_name?: string | null
  quantity: number
  buy_mode?: string | null
  buy_unit?: string | null
  unit_price: number
  mrp?: number | null
  total_price: number
  discount_amount?: number | null
  hsn_code?: string | null
  gst_rate?: number | null
  taxable_amount?: number | null
  cgst_amount?: number | null
  sgst_amount?: number | null
  igst_amount?: number | null
  image_url?: string | null
}

export interface PackingSlipAddress {
  full_name: string
  address_line1: string
  address_line2?: string | null
  landmark?: string | null
  city: string
  state: string
  postal_code: string
  phone?: string | null
}

export interface PackingSlipOrder {
  id: string
  order_number: string
  created_at: string
  customer_name: string
  customer_phone?: string | null
  shipping_address: PackingSlipAddress | null
  items: PackingSlipItem[]
  total_amount: number
  subtotal?: number
  discount_amount?: number
  business_discount_amount?: number
  shipping_amount?: number
  taxable_amount?: number
  cgst_amount?: number
  sgst_amount?: number
  igst_amount?: number
  is_igst?: boolean
}

export interface StoreSettings {
  name: string
  address: string
  city: string
  phone: string
  email: string
  gstin: string
  web: string
}

export async function loadStoreSettings(): Promise<StoreSettings> {
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

const PAGE_W = 595.28
const PAGE_H = 841.89
const ML = 36
const MR = 36
const CW = PAGE_W - ML - MR

const GREEN_DARK = '#3d6b00'
const GREEN_MID = '#5a8a00'
const GREEN_MAIN = '#7cb900'
const LIGHT_BG = '#f4f9ea'
const RULE_COLOR = '#cccccc'
const TEXT_DARK = '#111111'
const TEXT_MID = '#444444'
const TEXT_MUTED = '#666666'
const TEXT_LIGHT = '#d4edaa'

async function generateQRBuffer(orderNumber: string): Promise<Buffer> {
  return QRCode.toBuffer(orderNumber, {
    type: 'png',
    width: 100,
    margin: 1,
  })
}

async function generateBarcodeBuffer(orderNumber: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: orderNumber,
    scale: 2,
    height: 8,
    includetext: true,
    textxalign: 'center',
    textsize: 6,
  })
}

function rs(n: number) {
  return 'Rs.' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function hRule(doc: any, x1: number, y: number, x2: number, color = RULE_COLOR, w = 0.5) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke()
}

function box(doc: any, x: number, y: number, w: number, h: number, fill: string) {
  doc.rect(x, y, w, h).fillColor(fill).fill()
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

async function renderPage(doc: any, order: PackingSlipOrder, store: StoreSettings): Promise<void> {
  let qrBuf: Buffer | null = null
  let barBuf: Buffer | null = null
  try {
    qrBuf = await generateQRBuffer(order.order_number)
  } catch {
    /* non-fatal */
  }
  try {
    barBuf = await generateBarcodeBuffer(order.order_number)
  } catch {
    /* non-fatal */
  }

  const QR_SIZE = 66
  const HEADER_H = 90
  const LOGO_SIZE = 58
  const LOGO_PATH = path.join(process.cwd(), 'public', 'images', 'store-logo.png')

  // ── Header bar ──────────────────────────────────────────────────────────────
  box(doc, 0, 0, PAGE_W, HEADER_H, GREEN_DARK)

  const textZoneW = CW - LOGO_SIZE - QR_SIZE - 24

  try {
    doc.image(LOGO_PATH, ML, Math.floor((HEADER_H - LOGO_SIZE) / 2), { width: LOGO_SIZE, height: LOGO_SIZE })
  } catch {
    /* logo missing */
  }

  const textX = ML + LOGO_SIZE + 12
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff')
  doc.text(store.name.toUpperCase(), textX, 14, { width: textZoneW, lineBreak: false })

  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_LIGHT)
  let hy = 38
  const addrLine = [store.address, store.city].filter(Boolean).join(', ')
  if (addrLine) {
    doc.text(addrLine, textX, hy, { width: textZoneW, lineBreak: false })
    hy += 11
  }
  const contactParts = [store.phone && `Ph: ${store.phone}`, store.email].filter(Boolean)
  if (contactParts.length) {
    doc.text(contactParts.join('  |  '), textX, hy, { width: textZoneW, lineBreak: false })
    hy += 11
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_LIGHT)
  doc.text('PACKING SLIP', textX, hy, { width: textZoneW, lineBreak: false })

  if (qrBuf) {
    try {
      doc.image(qrBuf, PAGE_W - MR - QR_SIZE, Math.floor((HEADER_H - QR_SIZE) / 2), { width: QR_SIZE, height: QR_SIZE })
    } catch {
      /* qr render failed */
    }
  }

  let y = HEADER_H + 8

  // ── Order number bar ────────────────────────────────────────────────────────
  box(doc, ML, y, CW, 24, LIGHT_BG)
  doc.rect(ML, y, CW, 24).lineWidth(0.4).strokeColor(RULE_COLOR).stroke()
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN_DARK)
  doc.text(`ORDER: #${order.order_number}`, ML + 8, y + 8, { lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
  doc.text(`Date: ${fmtDate(order.created_at)}`, ML + 8 + 200, y + 8, { lineBreak: false })
  if (store.gstin) {
    doc.text(`GSTIN: ${store.gstin}`, ML + 8 + 350, y + 8, { width: CW - 362, align: 'right', lineBreak: false })
  }
  y += 24 + 8

  const INNER_PAD = 10
  const HDR_ROW_H = 20

  // ── SHIP TO section (full width) ────────────────────────────────────────────
  const addr = order.shipping_address
  let addrContentH = 0
  if (addr) {
    addrContentH += 14 // name
    addrContentH += 12 // line1
    if (addr.address_line2) addrContentH += 12
    if (addr.landmark) addrContentH += 12
    addrContentH += 12 // city, state
    addrContentH += 12 // PIN
    if (addr.phone || order.customer_phone) addrContentH += 13
  } else {
    addrContentH = 12
  }
  const ADDR_SECTION_H = HDR_ROW_H + INNER_PAD + addrContentH + INNER_PAD

  doc.rect(ML, y, CW, ADDR_SECTION_H).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()
  box(doc, ML, y, CW, HDR_ROW_H, LIGHT_BG)
  hRule(doc, ML, y + HDR_ROW_H, ML + CW, RULE_COLOR, 0.4)
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN_DARK)
  doc.text('SHIP TO', ML + 8, y + 6, { lineBreak: false })

  let addrY = y + HDR_ROW_H + INNER_PAD
  if (addr) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT_DARK)
    doc.text(addr.full_name, ML + 8, addrY, { width: CW - 16, lineBreak: false })
    addrY += 14

    doc.font('Helvetica').fontSize(8.5).fillColor('#333333')
    doc.text(addr.address_line1, ML + 8, addrY, { width: CW - 16, lineBreak: false })
    addrY += 12

    if (addr.address_line2) {
      doc.text(addr.address_line2, ML + 8, addrY, { width: CW - 16, lineBreak: false })
      addrY += 12
    }
    if (addr.landmark) {
      doc.fillColor(TEXT_MUTED)
      doc.text(`Near: ${addr.landmark}`, ML + 8, addrY, { width: CW - 16, lineBreak: false })
      addrY += 12
      doc.fillColor('#333333')
    }
    doc.text(`${addr.city}, ${addr.state}`, ML + 8, addrY, { width: CW - 16, lineBreak: false })
    addrY += 12
    doc.text(`PIN: ${addr.postal_code}`, ML + 8, addrY, { width: CW - 16, lineBreak: false })
    addrY += 12

    const phone = addr.phone || order.customer_phone
    if (phone) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN_DARK)
      doc.text(`Ph: ${phone}`, ML + 8, addrY, { width: CW - 16, lineBreak: false })
    }
  } else {
    doc.font('Helvetica').fontSize(8.5).fillColor('#999999')
    doc.text('No shipping address on file', ML + 8, addrY, { width: CW - 16, lineBreak: false })
  }

  y += ADDR_SECTION_H + 10

  // ── ORDER ITEMS section (full width) ────────────────────────────────────────
  const IMG_SIZE = 30
  const COL_IMG = IMG_SIZE + 6 // 36
  const COL_HSN = 52
  const COL_GST = 34
  const COL_QTY = 52
  const COL_RATE = 54
  const COL_DISC = 38
  const COL_AMT = 62
  const COL_PROD = CW - 16 - COL_IMG - COL_HSN - COL_GST - COL_QTY - COL_RATE - COL_DISC - COL_AMT

  const tblX = ML + 8
  const nameColW = COL_PROD

  // Pre-fetch all product images
  const imageBufs: (Buffer | null)[] = await Promise.all(
    order.items.map(item => (item.image_url ? fetchImageBuffer(item.image_url) : Promise.resolve(null)))
  )

  // Pre-measure row heights
  const COL_HDR_H = 22 // two-line header
  const varLineH = 10
  const ROW_V_PAD = 8
  const rowHeights = order.items.map(item => {
    const nameH = doc.font('Helvetica').fontSize(8).heightOfString(item.product_name, { width: nameColW })
    let contentH = nameH + ROW_V_PAD
    if (item.variant_name) contentH += varLineH + 2
    return Math.max(contentH, IMG_SIZE + ROW_V_PAD)
  })

  const TOTAL_BAR_H = 22

  // Summary rows below items
  const isIgst = !!order.is_igst
  const hasTax = (order.cgst_amount || 0) + (order.sgst_amount || 0) + (order.igst_amount || 0) > 0
  const hasOrderDiscount = (order.discount_amount || 0) > 0
  const hasBizDiscount = (order.business_discount_amount || 0) > 0
  const hasShipping = (order.shipping_amount || 0) > 0
  const summaryRowH = 14
  let summaryRowCount = hasTax ? (isIgst ? 2 : 3) : 1 // taxable + igst OR cgst+sgst
  if (hasOrderDiscount) summaryRowCount++
  if (hasBizDiscount) summaryRowCount++
  if (hasShipping) summaryRowCount++
  const SUMMARY_H = summaryRowCount * summaryRowH + TOTAL_BAR_H

  // Bottom limit for flowing content: leave room for the seller/footer/barcode zones.
  const FOOTER_H = 28
  const BAR_ZONE_H = 52
  const SELLER_BLOCK_H = 90 // seller details + handling instructions + rule/padding
  const CONTENT_BOTTOM = PAGE_H - FOOTER_H - BAR_ZONE_H - SELLER_BLOCK_H

  // Two-line column header — repeated at the top of the items table on every page.
  function drawItemsHeader(atY: number): number {
    box(doc, ML + 1, atY, CW - 2, COL_HDR_H, '#e8f5c8')
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(GREEN_DARK)
    const hdrY1 = atY + 3
    const hdrY2 = atY + 12
    // row 1
    doc.text('PRODUCT', tblX + COL_IMG, hdrY1, { width: COL_PROD, lineBreak: false })
    doc.text('HSN/', tblX + COL_IMG + COL_PROD, hdrY1, { width: COL_HSN, align: 'center', lineBreak: false })
    doc.text('GST', tblX + COL_IMG + COL_PROD + COL_HSN, hdrY1, { width: COL_GST, align: 'center', lineBreak: false })
    doc.text('QTY', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST, hdrY1, {
      width: COL_QTY,
      align: 'center',
      lineBreak: false,
    })
    doc.text('RATE', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY, hdrY1, {
      width: COL_RATE,
      align: 'right',
      lineBreak: false,
    })
    doc.text('DISC', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE, hdrY1, {
      width: COL_DISC,
      align: 'center',
      lineBreak: false,
    })
    doc.text('AMOUNT', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE + COL_DISC, hdrY1, {
      width: COL_AMT,
      align: 'right',
      lineBreak: false,
    })
    doc.text('(Incl.Tax)', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE + COL_DISC, hdrY2, {
      width: COL_AMT,
      align: 'right',
      lineBreak: false,
    })
    // row 2
    doc.text('SAC', tblX + COL_IMG + COL_PROD, hdrY2, { width: COL_HSN, align: 'center', lineBreak: false })
    doc.text('%', tblX + COL_IMG + COL_PROD + COL_HSN, hdrY2, { width: COL_GST, align: 'center', lineBreak: false })
    doc.text('(Incl.Tax)', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY, hdrY2, {
      width: COL_RATE,
      align: 'right',
      lineBreak: false,
    })
    doc.text('%', tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE, hdrY2, {
      width: COL_DISC,
      align: 'center',
      lineBreak: false,
    })
    return atY + COL_HDR_H
  }

  // ── ORDER ITEMS: section title band + first-page column header ────────────────
  box(doc, ML, y, CW, HDR_ROW_H, LIGHT_BG)
  doc.rect(ML, y, CW, HDR_ROW_H).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN_DARK)
  doc.text('ORDER ITEMS', ML + 8, y + 6, { lineBreak: false })

  let iy = y + HDR_ROW_H
  let segTop = iy // top of the current page's row segment (for the border box)
  iy = drawItemsHeader(iy)

  // Close the current page's table border around [segTop .. iy].
  function closeItemsSegment() {
    doc
      .rect(ML, segTop, CW, iy - segTop)
      .lineWidth(0.5)
      .strokeColor(RULE_COLOR)
      .stroke()
  }

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i]
    const rowH = rowHeights[i]
    const imgBuf = imageBufs[i]

    // Page-break BEFORE the row so a row is never split across pages.
    if (iy + rowH > CONTENT_BOTTOM) {
      closeItemsSegment()
      doc.font('Helvetica').fontSize(6).fillColor(TEXT_MUTED)
      doc.text('Continued on next page…', ML, iy + 2, { width: CW, align: 'center', lineBreak: false })
      doc.addPage()
      iy = HEADER_H + 8
      segTop = iy
      iy = drawItemsHeader(iy)
    }

    const isWL = item.buy_mode === 'weight' || item.buy_mode === 'length'
    const unitLabel = item.buy_unit ? item.buy_unit.toUpperCase() : 'NOS'
    const qtyStr = isWL
      ? `${Number(item.quantity).toFixed(3)} ${unitLabel}`
      : `${Math.round(Number(item.quantity))} ${unitLabel}`

    // Discount %
    let discPct = 0
    if (item.mrp != null && item.mrp > 0 && item.quantity > 0) {
      const mrpTotal = item.mrp * item.quantity
      discPct = mrpTotal > item.total_price ? ((mrpTotal - item.total_price) / mrpTotal) * 100 : 0
    } else if (item.discount_amount && item.discount_amount > 0) {
      const gross = item.total_price + item.discount_amount
      discPct = gross > 0 ? (item.discount_amount / gross) * 100 : 0
    }
    const discStr = discPct >= 0.01 ? `${discPct.toFixed(1)}%` : ''

    const rateInclTax = item.mrp != null && item.mrp > 0 ? item.mrp : item.unit_price
    const gstStr = item.gst_rate ? `${item.gst_rate}%` : ''

    // Thumbnail
    if (imgBuf) {
      try {
        doc.image(imgBuf, tblX, iy + 4, { width: IMG_SIZE, height: IMG_SIZE })
      } catch {
        /* image render failed */
      }
    } else {
      doc
        .rect(tblX, iy + 4, IMG_SIZE, IMG_SIZE)
        .lineWidth(0.3)
        .strokeColor('#dddddd')
        .stroke()
    }

    // Product name (wrapping)
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK)
    doc.text(item.product_name, tblX + COL_IMG, iy + 4, { width: COL_PROD, lineBreak: true })

    if (item.variant_name) {
      const afterName = doc.y + 2
      doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED)
      doc.text(item.variant_name, tblX + COL_IMG + 4, afterName, { width: COL_PROD - 4, lineBreak: false })
    }

    // Right-side columns — vertically centred
    const midY = iy + Math.floor(rowH / 2) - 5
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_DARK)
    doc.text(item.hsn_code || '', tblX + COL_IMG + COL_PROD, midY, {
      width: COL_HSN,
      align: 'center',
      lineBreak: false,
    })
    doc.text(gstStr, tblX + COL_IMG + COL_PROD + COL_HSN, midY, { width: COL_GST, align: 'center', lineBreak: false })
    doc.text(qtyStr, tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST, midY, {
      width: COL_QTY,
      align: 'center',
      lineBreak: false,
    })
    doc.text(rs(rateInclTax), tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY, midY, {
      width: COL_RATE,
      align: 'right',
      lineBreak: false,
    })
    doc.text(discStr, tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE, midY, {
      width: COL_DISC,
      align: 'center',
      lineBreak: false,
    })
    doc.font('Helvetica-Bold').fontSize(7.5)
    doc.text(
      rs(item.total_price),
      tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE + COL_DISC,
      midY,
      { width: COL_AMT, align: 'right', lineBreak: false }
    )

    iy += rowH
    hRule(doc, tblX, iy, tblX + CW - 16, '#eeeeee', 0.3)
  }

  // Keep the summary + TOTAL bar together: if they won't fit under the last rows,
  // close this page's table and move the whole block to a fresh page.
  if (iy + SUMMARY_H > CONTENT_BOTTOM) {
    closeItemsSegment()
    doc.addPage()
    iy = HEADER_H + 8
    segTop = iy
    iy = drawItemsHeader(iy)
  }

  // ── Summary rows ──────────────────────────────────────────────────────────────
  const summaryLabelX = tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY
  const summaryLabelW = COL_RATE + COL_DISC - 4
  const summaryAmtX = tblX + COL_IMG + COL_PROD + COL_HSN + COL_GST + COL_QTY + COL_RATE + COL_DISC
  const summaryAmtW = COL_AMT

  function summaryRow(label: string, value: string, bold = false, color = TEXT_MID) {
    hRule(doc, ML + 1, iy, ML + CW - 1, '#eeeeee', 0.3)
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7.5)
      .fillColor(color)
    doc.text(label, summaryLabelX, iy + 3, { width: summaryLabelW, align: 'right', lineBreak: false })
    doc.text(value, summaryAmtX, iy + 3, { width: summaryAmtW, align: 'right', lineBreak: false })
    iy += summaryRowH
  }

  if (hasTax) {
    const taxable = order.taxable_amount ?? order.items.reduce((s, it) => s + (it.taxable_amount ?? 0), 0)
    summaryRow('Taxable Amount', rs(taxable))
    if (isIgst) {
      summaryRow('IGST', rs(order.igst_amount || 0))
    } else {
      summaryRow('CGST', rs(order.cgst_amount || 0))
      summaryRow('SGST', rs(order.sgst_amount || 0))
    }
  }
  if (hasOrderDiscount) summaryRow('Discount', `-${rs(order.discount_amount!)}`, false, '#166534')
  if (hasBizDiscount) summaryRow('Business Discount', `-${rs(order.business_discount_amount!)}`, false, '#166534')
  if (hasShipping) summaryRow('Delivery Charges', rs(order.shipping_amount!))

  // Total bar (flows right after the summary rows)
  const totalBarY = iy
  box(doc, ML + 1, totalBarY, CW - 2, TOTAL_BAR_H, GREEN_MAIN)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
  doc.text('TOTAL', tblX, totalBarY + 7, { width: CW - 16 - COL_AMT - 4, align: 'right', lineBreak: false })
  doc.text(rs(order.total_amount), summaryAmtX, totalBarY + 7, { width: summaryAmtW, align: 'right', lineBreak: false })
  iy += TOTAL_BAR_H

  // Close the final page's table border around all rows + summary on this page.
  closeItemsSegment()

  y = iy + 14

  // ── Seller details + handling instructions ───────────────────────────────────
  hRule(doc, ML, y, ML + CW, GREEN_MID, 1)
  y += 12

  const INFO_COL_W = Math.floor(CW * 0.55)
  const INFO_COL2_X = ML + INFO_COL_W + 16

  const infoStartY = y
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN_DARK)
  doc.text('SELLER DETAILS', ML, y, { lineBreak: false })
  y += 11
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MID)

  if (store.name) {
    doc.text(store.name, ML, y, { width: INFO_COL_W, lineBreak: false })
    y += 10
  }
  if (store.address || store.city) {
    const addrStr = [store.address, store.city].filter(Boolean).join(', ')
    doc.text(addrStr, ML, y, { width: INFO_COL_W })
    y = doc.y + 2
  }
  if (store.phone) {
    doc.text(`Ph: ${store.phone}`, ML, y, { width: INFO_COL_W, lineBreak: false })
    y += 10
  }
  const sellerLine2Parts: string[] = []
  if (store.email) sellerLine2Parts.push(`Email: ${store.email}`)
  if (store.gstin) sellerLine2Parts.push(`GSTIN: ${store.gstin}`)
  if (sellerLine2Parts.length) {
    doc.text(sellerLine2Parts.join('   |   '), ML, y, { width: INFO_COL_W, lineBreak: false })
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN_DARK)
  doc.text('HANDLING INSTRUCTIONS', INFO_COL2_X, infoStartY, { width: CW - INFO_COL_W - 16, lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
  doc.text('Handle with care. Keep dry.\nDo not bend or compress.', INFO_COL2_X, infoStartY + 11, {
    width: CW - INFO_COL_W - 16,
  })

  // ── Footer + barcode ─────────────────────────────────────────────────────────
  const footerY = PAGE_H - FOOTER_H
  const barZoneY = footerY - BAR_ZONE_H

  box(doc, 0, barZoneY, PAGE_W, BAR_ZONE_H, '#ffffff')
  hRule(doc, ML, barZoneY + 4, ML + CW, '#dddddd', 0.5)

  if (barBuf) {
    const barW = 220
    const barH = 38
    try {
      doc.image(barBuf, Math.floor((PAGE_W - barW) / 2), barZoneY + 7, { width: barW, height: barH })
    } catch {
      /* barcode render failed */
    }
  }

  box(doc, 0, footerY, PAGE_W, FOOTER_H, GREEN_DARK)
  const footerParts = [
    `Thank you for shopping with ${store.name}`,
    store.web,
    store.email ? `Questions? ${store.email}` : null,
  ]
    .filter(Boolean)
    .join('   —   ')
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_LIGHT)
  doc.text(footerParts, ML, footerY + 9, { width: CW, align: 'center', lineBreak: false })
}

export async function generatePackingSlipPDF(order: PackingSlipOrder, store: StoreSettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    renderPage(doc, order, store)
      .then(() => doc.end())
      .catch(reject)
  })
}

export async function generateBulkPackingSlipPDF(orders: PackingSlipOrder[], store: StoreSettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    async function renderAll() {
      for (let i = 0; i < orders.length; i++) {
        doc.addPage()
        await renderPage(doc, orders[i], store)
      }
      doc.end()
    }

    renderAll().catch(reject)
  })
}
