import { queryMany } from '@/lib/db'

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
  total_price: number
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
  shipping_amount?: number
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
    web: 'www.jeffistores.in',
  }
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const ML = 36
const MR = 36
const CW = PAGE_W - ML - MR

const NAVY = '#1e3a5f'
const LIGHT_BG = '#f4f6f9'
const RULE_COLOR = '#cccccc'
const TEXT_DARK = '#111111'
const TEXT_MID = '#444444'
const TEXT_MUTED = '#666666'
const TEXT_LIGHT = '#a8c4e0'

async function generateQRBuffer(orderNumber: string): Promise<Buffer> {
  return QRCode.toBuffer(orderNumber, {
    type: 'png', width: 100, margin: 1,
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

function clip(str: string, max: number) {
  return str && str.length > max ? str.slice(0, max - 1) + '...' : (str || '')
}

function hRule(doc: any, x1: number, y: number, x2: number, color = RULE_COLOR, w = 0.5) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke()
}

function box(doc: any, x: number, y: number, w: number, h: number, fill: string) {
  doc.rect(x, y, w, h).fillColor(fill).fill()
}

async function renderPage(doc: any, order: PackingSlipOrder, store: StoreSettings): Promise<void> {
  let qrBuf: Buffer | null = null
  let barBuf: Buffer | null = null
  try { qrBuf = await generateQRBuffer(order.order_number) } catch {}
  try { barBuf = await generateBarcodeBuffer(order.order_number) } catch {}

  const QR_SIZE = 66

  const HEADER_TEXT_LINES = 1 + (store.address ? 1 : 0) + (store.city ? 1 : 0) + 1 + 1
  const HEADER_H = 14 + (HEADER_TEXT_LINES * 11) + 14

  box(doc, 0, 0, PAGE_W, HEADER_H, NAVY)

  const textZoneW = CW - QR_SIZE - 16

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff')
  doc.text(store.name.toUpperCase(), ML, 14, { width: textZoneW, lineBreak: false })

  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_LIGHT)
  let hy = 38
  if (store.address) {
    doc.text(store.address, ML, hy, { width: textZoneW, lineBreak: false })
    hy += 11
  }
  if (store.city) {
    doc.text(store.city, ML, hy, { width: textZoneW, lineBreak: false })
    hy += 11
  }
  const contactParts = [store.phone && `Ph: ${store.phone}`, store.email].filter(Boolean)
  if (contactParts.length) {
    doc.text(contactParts.join('  |  '), ML, hy, { width: textZoneW, lineBreak: false })
    hy += 11
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#dce8f5')
  doc.text('PACKING SLIP', ML, hy, { width: textZoneW, lineBreak: false })

  if (qrBuf) {
    try { doc.image(qrBuf, PAGE_W - MR - QR_SIZE, Math.floor((HEADER_H - QR_SIZE) / 2), { width: QR_SIZE, height: QR_SIZE }) } catch {}
  }

  let y = HEADER_H + 8

  box(doc, ML, y, CW, 24, LIGHT_BG)
  doc.rect(ML, y, CW, 24).lineWidth(0.4).strokeColor(RULE_COLOR).stroke()
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
  doc.text(`ORDER: #${order.order_number}`, ML + 8, y + 8, { lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
  doc.text(`Date: ${fmtDate(order.created_at)}`, ML + 8 + 200, y + 8, { lineBreak: false })
  if (store.gstin) {
    doc.text(`GSTIN: ${store.gstin}`, ML + 8 + 350, y + 8, { width: CW - 362, align: 'right', lineBreak: false })
  }
  y += 24 + 8

  const COL1W = Math.floor(CW * 0.40)
  const COL2X = ML + COL1W
  const COL2W = CW - COL1W

  const COL_QTY = 54
  const COL_AMT = 74
  const COL_PROD = COL2W - 16 - COL_QTY - COL_AMT

  const HEADER_ROW_H = 20
  const COL_HDR_H = 18
  const itemLineH = 14
  const varLineH = 10
  const SEP_H = 5

  let addrH = 0
  const addr = order.shipping_address
  if (addr) {
    addrH += 14
    addrH += 12
    if (addr.address_line2) addrH += 12
    if (addr.landmark) addrH += 12
    addrH += 12
    addrH += 12
    if (addr.phone || order.customer_phone) addrH += 13
  } else {
    addrH = 12
  }

  let itemsContentH = 0
  for (const item of order.items) {
    itemsContentH += itemLineH
    if (item.variant_name) itemsContentH += varLineH
    itemsContentH += SEP_H
  }

  const TOTAL_BAR_H = 22
  const itemsColH = COL_HDR_H + itemsContentH + TOTAL_BAR_H + 6

  const INNER_PAD = 10
  const SECTION_H = HEADER_ROW_H + INNER_PAD + Math.max(addrH, itemsColH) + INNER_PAD

  doc.rect(ML, y, COL1W, SECTION_H).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()
  doc.rect(COL2X, y, COL2W, SECTION_H).lineWidth(0.5).strokeColor(RULE_COLOR).stroke()

  box(doc, ML, y, COL1W, HEADER_ROW_H, LIGHT_BG)
  box(doc, COL2X, y, COL2W, HEADER_ROW_H, LIGHT_BG)
  hRule(doc, ML, y + HEADER_ROW_H, ML + COL1W, RULE_COLOR, 0.4)
  hRule(doc, COL2X, y + HEADER_ROW_H, COL2X + COL2W, RULE_COLOR, 0.4)

  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
  doc.text('SHIP TO', ML + 8, y + 6, { lineBreak: false })
  doc.text('ORDER ITEMS', COL2X + 8, y + 6, { lineBreak: false })

  let addrY = y + HEADER_ROW_H + INNER_PAD
  if (addr) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT_DARK)
    doc.text(clip(addr.full_name, 30), ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
    addrY += 14

    doc.font('Helvetica').fontSize(8.5).fillColor('#333333')
    doc.text(clip(addr.address_line1, 38), ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
    addrY += 12

    if (addr.address_line2) {
      doc.text(clip(addr.address_line2, 38), ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
      addrY += 12
    }
    if (addr.landmark) {
      doc.fillColor(TEXT_MUTED)
      doc.text(`Near: ${clip(addr.landmark, 36)}`, ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
      addrY += 12
      doc.fillColor('#333333')
    }
    doc.text(`${addr.city}, ${addr.state}`, ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
    addrY += 12
    doc.text(`PIN: ${addr.postal_code}`, ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
    addrY += 12

    const phone = addr.phone || order.customer_phone
    if (phone) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
      doc.text(`Ph: ${phone}`, ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
    }
  } else {
    doc.font('Helvetica').fontSize(8.5).fillColor('#999999')
    doc.text('No shipping address on file', ML + 8, addrY, { width: COL1W - 16, lineBreak: false })
  }

  const tblX = COL2X + 8
  const tblW = COL2W - 16

  let iy = y + HEADER_ROW_H + INNER_PAD

  box(doc, COL2X + 1, iy, COL2W - 2, COL_HDR_H, '#edf0f5')
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY)
  doc.text('PRODUCT', tblX, iy + 5, { width: COL_PROD, lineBreak: false })
  doc.text('QTY', tblX + COL_PROD, iy + 5, { width: COL_QTY, align: 'center', lineBreak: false })
  doc.text('AMOUNT', tblX + COL_PROD + COL_QTY, iy + 5, { width: COL_AMT, align: 'right', lineBreak: false })
  iy += COL_HDR_H

  for (const item of order.items) {
    const isWL = item.buy_mode === 'weight' || item.buy_mode === 'length'
    const qtyStr = isWL
      ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit || ''}`
      : `${Math.round(Number(item.quantity))}`

    doc.font('Helvetica').fontSize(8.5).fillColor(TEXT_DARK)
    doc.text(clip(item.product_name, 38), tblX, iy + 2, { width: COL_PROD, lineBreak: false })
    doc.text(qtyStr, tblX + COL_PROD, iy + 2, { width: COL_QTY, align: 'center', lineBreak: false })
    doc.text(rs(item.total_price), tblX + COL_PROD + COL_QTY, iy + 2, { width: COL_AMT, align: 'right', lineBreak: false })
    iy += itemLineH

    if (item.variant_name) {
      doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
      doc.text(clip(item.variant_name, 42), tblX + 6, iy, { width: COL_PROD - 6, lineBreak: false })
      iy += varLineH
    }

    hRule(doc, tblX, iy, tblX + tblW, '#eeeeee', 0.3)
    iy += SEP_H
  }

  const totalBarY = y + SECTION_H - TOTAL_BAR_H - INNER_PAD
  if (order.discount_amount && order.discount_amount > 0) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
    doc.text('Discount:', tblX + COL_PROD - 10, totalBarY - 14, { width: COL_QTY + 10, align: 'right', lineBreak: false })
    doc.fillColor('#166534')
    doc.text(`-${rs(order.discount_amount)}`, tblX + COL_PROD + COL_QTY, totalBarY - 14, { width: COL_AMT, align: 'right', lineBreak: false })
  }

  box(doc, COL2X + 1, totalBarY, COL2W - 2, TOTAL_BAR_H, NAVY)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
  doc.text('TOTAL', tblX, totalBarY + 7, { width: COL_PROD + COL_QTY - 4, align: 'right', lineBreak: false })
  doc.text(rs(order.total_amount), tblX + COL_PROD + COL_QTY, totalBarY + 7, { width: COL_AMT, align: 'right', lineBreak: false })

  y = y + SECTION_H + 14

  hRule(doc, ML, y, ML + CW, NAVY, 1)
  y += 12

  const INFO_COL_W = Math.floor(CW * 0.55)
  const INFO_COL2_X = ML + INFO_COL_W + 16

  const infoStartY = y
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
  doc.text('SELLER DETAILS', ML, y)
  y += 11
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)

  const sellerParts: string[] = []
  if (store.name) sellerParts.push(store.name)
  if (store.address) sellerParts.push(store.address)
  if (store.city) sellerParts.push(store.city)
  doc.text(sellerParts.join(', '), ML, y, { width: INFO_COL_W })
  y += 11

  const contactParts2: string[] = []
  if (store.phone) contactParts2.push(`Ph: ${store.phone}`)
  if (store.email) contactParts2.push(`Email: ${store.email}`)
  if (store.gstin) contactParts2.push(`GSTIN: ${store.gstin}`)
  if (contactParts2.length) {
    doc.text(contactParts2.join('   |   '), ML, y, { width: INFO_COL_W })
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
  doc.text('HANDLING INSTRUCTIONS', INFO_COL2_X, infoStartY, { width: CW - INFO_COL_W - 16, lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MID)
  doc.text('Handle with care. Keep dry.\nDo not bend or compress.', INFO_COL2_X, infoStartY + 11, { width: CW - INFO_COL_W - 16 })

  const FOOTER_H = 28
  const BAR_ZONE_H = 52
  const footerY = PAGE_H - FOOTER_H
  const barZoneY = footerY - BAR_ZONE_H

  box(doc, 0, barZoneY, PAGE_W, BAR_ZONE_H, '#ffffff')
  hRule(doc, ML, barZoneY + 4, ML + CW, '#dddddd', 0.5)

  if (barBuf) {
    const barW = 220
    const barH = 38
    try {
      doc.image(barBuf, Math.floor((PAGE_W - barW) / 2), barZoneY + 7, { width: barW, height: barH })
    } catch {}
  }

  box(doc, 0, footerY, PAGE_W, FOOTER_H, NAVY)
  const footerParts = [
    `Thank you for shopping with ${store.name}`,
    store.web,
    store.email ? `Questions? ${store.email}` : null,
  ].filter(Boolean).join('   —   ')
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
    renderPage(doc, order, store).then(() => doc.end()).catch(reject)
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
