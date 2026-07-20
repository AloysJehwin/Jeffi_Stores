/**
 * Shared 4×6" Delhivery-style shipping-label PDF builder.
 *
 * Extracted from the single-order label route so it can be reused for bulk label
 * generation (one label per AWB in a pickup request, merged into a single PDF).
 * pdfkit / bwip-js are loaded via the eval('require') workaround used across the
 * PDF libs. Route files can't export non-handler symbols, hence this lib.
 */
import { round2 } from '@/lib/gst'

const PDFDocument = eval('require')('pdfkit')
const bwipjs = eval('require')('bwip-js')
const nodePath = eval('require')('path')

export interface LabelItem { name: string; qty: number; price: number; total: number }

export interface LabelInput {
  /** Delhivery packing-slip package object (or {} when unavailable). */
  pkg: any
  awb: string
  /** Order row: order_number, total_amount, address fields, full_name. */
  orderRow: any
  items: LabelItem[]
  /** 1-based page position + total, for the footer. */
  pageNum?: number
  pageCount?: number
}

async function barcode(text: string, heightMm: number): Promise<Buffer | null> {
  try {
    const safe = text.replace(/[^\x20-\x7E]/g, '').slice(0, 48) || 'X'
    return await bwipjs.toBuffer({ bcid: 'code128', text: safe, scale: 2, height: heightMm, includetext: false })
  } catch { return null }
}

/**
 * Draw one 4×6 label onto an existing pdfkit doc (assumes the current page is the
 * correct 288×432 page). Pre-fetches barcodes, so it's async.
 */
async function drawLabelPage(doc: any, input: LabelInput): Promise<void> {
  const { pkg, awb, orderRow, items } = input
  const M = 4
  const W = 4 * 72
  const H = 6 * 72
  const p = 8
  const BW = W - M * 2
  const BH = H - M * 2

  const sortCode: string = pkg.sort_code || pkg.st || ''
  const destPin: string = pkg.pin || orderRow.postal_code || ''
  const consigneeName: string = pkg.name || orderRow.full_name || ''
  const pkgAdd: string = pkg.add || ''
  const addrFromDB: string = [orderRow.address_line1, orderRow.address_line2, orderRow.landmark, orderRow.city, orderRow.state].filter(Boolean).join(', ')
  const consigneeAdd: string = pkgAdd || addrFromDB
  const sellerName: string = pkg.sname || 'Jeffi Stores'
  const sellerAdd: string = pkg.sadd || process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur'
  const invoiceNo: string = pkg.oid || pkg.order || orderRow.order_number || ''
  const productDesc: string = pkg.prd || 'Hardware / Fasteners'
  const codAmount: number = parseFloat(pkg.cod || '0')
  const totalAmount: string = pkg.total_amount || pkg.amount || (codAmount > 0 ? codAmount.toFixed(2) : String(round2(Number(orderRow.total_amount))))
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
    + ' | ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

  const addrLines = consigneeAdd.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean)
  const [awbBarBuf, invBarBuf] = await Promise.all([barcode(awb, 14), barcode(invoiceNo, 10)])

  doc.rect(M, M, BW, BH).lineWidth(1).strokeColor('#000').stroke()

  const hline = (yy: number, lw = 0.5) => doc.moveTo(M, yy).lineTo(M + BW, yy).lineWidth(lw).strokeColor('#000').stroke()
  const vline = (xx: number, y1: number, y2: number) => doc.moveTo(xx, y1).lineTo(xx, y2).lineWidth(0.5).strokeColor('#000').stroke()
  const clipLine = (text: string, maxW: number): string => {
    const s = (text ?? '').replace(/\s+/g, ' ').trim()
    if (!s) return ''
    if (doc.widthOfString(s) <= maxW) return s
    let t = s
    while (t.length > 1 && doc.widthOfString(t + '…') > maxW) t = t.slice(0, -1)
    return t + '…'
  }

  let y = M

  doc.fontSize(9).font('Helvetica').fillColor('#000').text(sellerName, M + p + 24, y + 8, { lineBreak: false })
  try {
    doc.image(nodePath.join(process.cwd(), 'public', 'images', 'store-logo.png'), M + p, y + 4, { width: 20, height: 20 })
  } catch { /* logo missing */ }
  try {
    const logoH = 18
    const logoW = Math.round(logoH * (3246 / 546))
    doc.image(nodePath.join(process.cwd(), 'public', 'delhivery-logo.png'), M + BW - logoW - p, y + 6, { width: logoW, height: logoH })
  } catch {
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#e63927').text('DELHIVERY', 0, y + 4, { width: M + BW - p, align: 'right', lineBreak: false })
  }
  y += 30; hline(y)

  doc.fontSize(7).font('Helvetica').fillColor('#000').text(`AWB# ${awb}`, M + p, y + 5, { lineBreak: false })
  if (awbBarBuf) doc.image(awbBarBuf, M + p, y + 15, { width: BW - p * 2, height: 46 })
  const pinY = y + 67
  doc.fontSize(8).font('Helvetica').fillColor('#000').text(destPin, M + p, pinY, { lineBreak: false })
  doc.fontSize(8).font('Helvetica-Bold').text(`AWB# ${awb}`, 0, pinY, { width: W, align: 'center', lineBreak: false })
  doc.fontSize(8).font('Helvetica-Bold').text(sortCode, 0, pinY, { width: M + BW - p, align: 'right', lineBreak: false })
  y += 90; hline(y)

  const col2X = M + Math.round(BW * 0.54)
  const row3Y = y
  const addrLineCount = Math.max(addrLines.length, 3)
  const row3H = Math.max(100, 28 + addrLineCount * 12 + 20)
  vline(col2X, row3Y, row3Y + row3H)

  const addrW = col2X - M - p * 2
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#555').text('SHIP TO', M + p, y + 5, { width: addrW, lineBreak: false })
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
  doc.text(clipLine(consigneeName, addrW), M + p, y + 15, { width: addrW, lineBreak: false })
  let addrY = y + 32
  const nameNorm = consigneeName.trim().toLowerCase()
  for (const line of addrLines) {
    if (line.trim().toLowerCase() === nameNorm) continue
    const isPinLine = /^\d{6}$/.test(line)
    doc.fontSize(isPinLine ? 9 : 8).font(isPinLine ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000')
      .text(clipLine(line, addrW), M + p, addrY, { width: addrW, lineBreak: false })
    addrY += 12
  }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(`PIN - ${destPin}`, M + p, row3Y + row3H - 16, { width: addrW, lineBreak: false })

  const rX = col2X + p
  const rW = M + BW - col2X - p * 2
  const payLabel = codAmount > 0 ? 'COD - Surface' : 'Pre-paid - Surface'
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(payLabel, rX, y + 6, { width: rW })
  if (totalAmount) doc.fontSize(11).font('Helvetica-Bold').text(`INR ${totalAmount}`, rX, y + 19, { width: rW })
  doc.moveTo(col2X, y + 37).lineTo(M + BW, y + 37).lineWidth(0.3).strokeColor('#aaa').stroke()
  doc.fontSize(7).font('Helvetica').fillColor('#000').text(`Inv# ${invoiceNo}`, rX, y + 41, { width: rW })
  doc.moveTo(col2X, y + 56).lineTo(M + BW, y + 56).lineWidth(0.3).strokeColor('#aaa').stroke()
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text('Date', rX, y + 60, { width: rW })
  doc.fontSize(7).font('Helvetica').fillColor('#000').text(dateStr, rX, y + 72, { width: rW })
  y += row3H; hline(y)

  const row4H = 72
  vline(col2X, y, y + row4H)
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#000').text(`Seller: ${sellerName}`, M + p, y + 6, { width: col2X - M - p * 2 })
  doc.fontSize(7).font('Helvetica').fillColor('#000').text(sellerAdd, M + p, y + 17, { width: col2X - M - p * 2 })
  const shortInv = invoiceNo.length > 22 ? invoiceNo.slice(0, 22) + '...' : invoiceNo
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(shortInv, col2X + p, y + 5, { width: rW })
  if (invBarBuf) doc.image(invBarBuf, col2X + p, y + 24, { width: rW - 2, height: 36 })
  y += row4H; hline(y)

  // ── Items table ──
  const colName = M + p
  const nameW = BW * 0.46
  const colQty = M + BW * 0.50
  const qtyW = 34
  const colPrice = M + BW * 0.64
  const priceW = 52
  const colTotal = M + BW * 0.80
  const totalW = BW * 0.20 - p

  doc.fontSize(7).font('Helvetica-Bold').fillColor('#000')
  doc.text('Product Name', colName, y + 6, { width: nameW, lineBreak: false })
  doc.text('Qty.', colQty, y + 6, { width: qtyW, align: 'right', lineBreak: false })
  doc.text('Price', colPrice, y + 6, { width: priceW, align: 'right', lineBreak: false })
  doc.text('Total', colTotal, y + 6, { width: totalW, align: 'right', lineBreak: false })
  y += 18; hline(y)

  const footerY = M + BH - 20
  const ROW = 12
  const TOTAL_ROW_H = 16
  const rowsTop = y + 4
  const maxRows = Math.max(1, Math.floor((footerY - rowsTop - TOTAL_ROW_H) / ROW))

  const list: LabelItem[] = items.length > 0
    ? items
    : [{ name: productDesc, qty: 1, price: Number(totalAmount) || 0, total: Number(totalAmount) || 0 }]

  const overflow = list.length > maxRows
  const shown = overflow ? list.slice(0, maxRows - 1) : list
  let ry = rowsTop
  doc.fontSize(7).font('Helvetica').fillColor('#000')
  for (const it of shown) {
    doc.font('Helvetica').fontSize(7)
    doc.text(clipLine(it.name || '-', nameW), colName, ry, { width: nameW, lineBreak: false })
    doc.text(String(it.qty), colQty, ry, { width: qtyW, align: 'right', lineBreak: false })
    doc.text(round2(it.price).toFixed(2), colPrice, ry, { width: priceW, align: 'right', lineBreak: false })
    doc.text(round2(it.total).toFixed(2), colTotal, ry, { width: totalW, align: 'right', lineBreak: false })
    ry += ROW
  }
  if (overflow) {
    const moreCount = list.length - shown.length
    doc.font('Helvetica-Oblique').fillColor('#555').text(`… and ${moreCount} more item${moreCount !== 1 ? 's' : ''}`, colName, ry, { width: nameW + qtyW, lineBreak: false })
    doc.fillColor('#000')
  }

  const grand = items.length > 0 ? items.reduce((s, it) => s + (Number(it.total) || 0), 0) : (Number(totalAmount) || 0)
  const totalRowY = footerY - TOTAL_ROW_H
  doc.moveTo(colPrice, totalRowY).lineTo(M + BW - p, totalRowY).lineWidth(0.4).strokeColor('#000').stroke()
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
  const valW = M + BW - p - colPrice
  doc.text('Total', colName, totalRowY + 4, { width: colPrice - colName - 6, align: 'right', lineBreak: false })
  doc.text(`INR ${round2(grand).toFixed(2)}`, colPrice, totalRowY + 4, { width: valW, align: 'right', lineBreak: false })

  hline(footerY)
  const pageStr = input.pageCount && input.pageCount > 1 ? `Page ${input.pageNum} of ${input.pageCount}` : 'Page 1 of 1'
  doc.fontSize(6.5).font('Helvetica').fillColor('#000').text(`Return Address: ${sellerAdd}`, M + p, footerY + 5, { width: BW * 0.78 - p })
  doc.text(pageStr, M + BW * 0.78, footerY + 5, { width: BW * 0.22 - p, align: 'right', lineBreak: false })
}

const PAGE: [number, number] = [4 * 72, 6 * 72]

/** Single-label 4×6 PDF. */
export async function buildLabelPDF(pkg: any, awb: string, orderRow: any, items: LabelItem[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: PAGE, margin: 0, autoFirstPage: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  await drawLabelPage(doc, { pkg, awb, orderRow, items })
  doc.end()
  return done
}

/** Merge many labels into one PDF — one 4×6 page per label. */
export async function buildMergedLabelsPDF(labels: LabelInput[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: PAGE, margin: 0, autoFirstPage: false })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const total = labels.length
  for (let i = 0; i < total; i++) {
    doc.addPage({ size: PAGE, margin: 0 })
    await drawLabelPage(doc, { ...labels[i], pageNum: i + 1, pageCount: total })
  }
  doc.end()
  return done
}
