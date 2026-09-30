import 'server-only'
const PDFDocument = eval('require')('pdfkit')

export interface ReceiptBusinessSettings {
  legalName: string
  tradeName: string
  address: string
  phone: string
  gstin: string
}

export interface ReceiptItem {
  product_name: string
  quantity: number
  unit_price: number
  discount_amount?: number
  total_price: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  gst_rate: number
  buy_unit?: string | null
}

export interface ReceiptOrder {
  invoice_number: string
  invoice_date: string
  payment_mode: string
  customer_name?: string
  notes?: string
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  is_igst: boolean
  total_amount: number
}

function toWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function convert(num: number): string {
    if (num === 0) return ''
    if (num < 20) return ones[num] + ' '
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' '
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred ' + convert(num % 100)
    if (num < 100000) return convert(Math.floor(num / 1000)) + 'Thousand ' + convert(num % 1000)
    if (num < 10000000) return convert(Math.floor(num / 100000)) + 'Lakh ' + convert(num % 100000)
    return convert(Math.floor(num / 10000000)) + 'Crore ' + convert(num % 10000000)
  }

  const rupees = Math.floor(n)
  const paise = Math.round((n - rupees) * 100)
  let result = convert(rupees).trim() + ' Rupees'
  if (paise > 0) result += ' and ' + convert(paise).trim() + ' Paise'
  return result + ' Only'
}

function fmtDate(d: string): string {
  const dt = new Date(d)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtAmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function generateReceiptPDF(
  order: ReceiptOrder,
  items: ReceiptItem[],
  business: ReceiptBusinessSettings
): Promise<Buffer> {
  const W = 226
  const MARGIN = 10
  const CW = W - MARGIN * 2
  const LINE_H = 9
  const FS = 7
  const FS_SM = 6.5

  function measureHeight(
    lines: Array<{ text: string; fs?: number; bold?: boolean; gap?: number }>
  ): number {
    let h = 0
    for (const l of lines) h += (l.fs ?? FS) + (l.gap ?? 1)
    return h
  }

  const headerLines = [
    { text: business.tradeName || business.legalName, fs: 10, bold: true, gap: 2 },
    { text: business.address, fs: 7, gap: 1 },
    ...(business.phone ? [{ text: `Ph: ${business.phone}`, fs: 7, gap: 1 }] : []),
    ...(business.gstin ? [{ text: `GSTIN: ${business.gstin}`, fs: 7, gap: 1 }] : []),
  ]

  const metaLines = [
    { text: '', fs: 9, bold: true, gap: 2 },
    { text: '', gap: 1 },
    { text: '', gap: 1 },
    { text: '', gap: 1 },
    ...(order.customer_name && order.customer_name.toLowerCase() !== 'walk-in customer'
      ? [{ text: '', gap: 1 }] : []),
  ]

  // Measure each item's WRAPPED name height (long names wrap to multiple lines) so estH is an
  // upper bound. A flat per-item budget under-estimates and lets PDFKit auto-paginate mid-draw
  // (the page has a fixed height until the correction at the end), exploding a long receipt into
  // hundreds of pages. Uses the same font/size/width as the item loop (colW.item = CW - 88).
  const ITEM_COL_W = CW - 88
  const nameMeasureDoc = new PDFDocument({ size: [W, 1000], margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, autoFirstPage: true })
  nameMeasureDoc.font('Helvetica').fontSize(FS)
  let itemsH = 0
  for (const it of items) {
    const nameH = nameMeasureDoc.heightOfString(it.product_name || '', { width: ITEM_COL_W })
    const discH = (it.discount_amount ?? 0) > 0 ? FS_SM + 1 : 0
    itemsH += nameH + discH + 2
  }
  nameMeasureDoc.end()
  const summaryLines = 1 + (order.is_igst ? (order.igst_amount > 0 ? 1 : 0) : (order.cgst_amount > 0 ? 1 : 0) + (order.sgst_amount > 0 ? 1 : 0)) + 1
  const notesH = order.notes ? FS_SM + 6 : 0
  const footerH = 7 + 6 + 2

  const estH =
    measureHeight(headerLines) + 8 +
    9 + 2 +
    measureHeight(metaLines) + 6 +
    LINE_H + 4 +
    itemsH + 4 +
    summaryLines * LINE_H + 8 +
    FS_SM + 6 +
    notesH +
    8 + footerH + MARGIN * 2

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [W, Math.max(100, estH)],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      autoFirstPage: true,
      bufferPages: true,
    })

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const x = MARGIN
    let y = MARGIN

    function draw(str: string, opts: Record<string, unknown> = {}, fs = FS, isBold = false) {
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs)
        .text(str, x, y, { width: CW, lineGap: 0, ...opts })
      if (!isBold) doc.font('Helvetica')
      y = doc.y
    }

    function ruler(dashed = false, gap = 2) {
      y += gap
      if (dashed) {
        doc.moveTo(x, y).lineTo(x + CW, y).lineWidth(0.3).dash(2, { space: 1 }).stroke('#000').undash()
      } else {
        doc.moveTo(x, y).lineTo(x + CW, y).lineWidth(0.5).stroke('#000')
      }
      y += gap
    }

    doc.font('Helvetica')

    draw(business.tradeName || business.legalName, { align: 'center' }, 10, true)
    y += 1
    draw(business.address, { align: 'center' }, 7)
    if (business.phone) draw(`Ph: ${business.phone}`, { align: 'center' }, 7)
    if (business.gstin) draw(`GSTIN: ${business.gstin}`, { align: 'center' }, 7)

    ruler(false, 3)
    draw('CASH SALE RECEIPT', { align: 'center' }, 9, true)
    y += 2

    const labelW = 58
    const valX = x + labelW

    function metaRow(label: string, val: string) {
      const ry = y
      doc.font('Helvetica').fontSize(FS).text(label, x, ry, { width: labelW, lineGap: 0 })
      doc.font('Helvetica').fontSize(FS).text(val, valX, ry, { width: CW - labelW, lineGap: 0 })
      y = Math.max(doc.y, ry + FS + 1) + 1
    }

    metaRow('Receipt No.', order.invoice_number)
    metaRow('Date', fmtDate(order.invoice_date))
    metaRow('Payment', order.payment_mode || 'Cash')
    if (order.customer_name && order.customer_name.toLowerCase() !== 'walk-in customer') {
      metaRow('Customer', order.customer_name)
    }

    ruler(true, 2)

    const col = { item: x, qty: x + CW - 88, rate: x + CW - 54, amt: x + CW - 30 }
    const colW = { item: CW - 88, qty: 34, rate: 24, amt: 30 }

    doc.font('Helvetica-Bold').fontSize(FS)
    doc.text('Item', col.item, y, { width: colW.item, lineGap: 0 })
    doc.text('Qty', col.qty, y, { width: colW.qty, align: 'right', lineGap: 0 })
    doc.text('Rate', col.rate, y, { width: colW.rate, align: 'right', lineGap: 0 })
    doc.text('Amt', col.amt, y, { width: colW.amt, align: 'right', lineGap: 0 })
    doc.font('Helvetica')
    y += FS + 2

    ruler(true, 1)

    for (const item of items) {
      const ry = y
      doc.font('Helvetica').fontSize(FS)
      const hasDiscount = (item.discount_amount ?? 0) > 0
      const mrpTotal = hasDiscount ? item.unit_price * item.quantity : 0
      const nameH = doc.heightOfString(item.product_name, { width: colW.item })
      const discH = hasDiscount ? FS_SM + 1 : 0
      const qtyStr = item.buy_unit
        ? `${parseFloat(String(item.quantity))} ${item.buy_unit}`
        : String(item.quantity)
      doc.text(item.product_name, col.item, ry, { width: colW.item, lineGap: 0 })
      if (hasDiscount) {
        doc.font('Helvetica').fontSize(FS_SM)
          .text(`MRP ₹${fmtAmt(mrpTotal)}  Disc -₹${fmtAmt(item.discount_amount!)}`, col.item, ry + nameH, { width: colW.item, lineGap: 0 })
        doc.font('Helvetica').fontSize(FS)
      }
      const ny = ry + Math.max(0, (nameH - FS) / 2)
      doc.text(qtyStr, col.qty, ny, { width: colW.qty, align: 'right', lineGap: 0 })
      doc.text(fmtAmt(item.unit_price), col.rate, ny, { width: colW.rate, align: 'right', lineGap: 0 })
      doc.text(fmtAmt(item.total_price), col.amt, ny, { width: colW.amt, align: 'right', lineGap: 0 })
      y = ry + nameH + discH + 2
    }

    ruler(true, 1)

    function sumRow(label: string, val: string, bold = false) {
      const ry = y
      const fs = bold ? 7.5 : FS
      const font = bold ? 'Helvetica-Bold' : 'Helvetica'
      doc.font(font).fontSize(fs).text(label, x, ry, { width: CW - 30, lineGap: 0 })
      doc.font(font).fontSize(fs).text(val, x + CW - 30, ry, { width: 30, align: 'right', lineGap: 0 })
      doc.font('Helvetica')
      y = ry + fs + 2
    }

    sumRow('Taxable Amount', fmtAmt(order.taxable_amount))
    if (order.is_igst && order.igst_amount > 0) {
      sumRow('IGST', fmtAmt(order.igst_amount))
    } else {
      if (order.cgst_amount > 0) sumRow('CGST', fmtAmt(order.cgst_amount))
      if (order.sgst_amount > 0) sumRow('SGST', fmtAmt(order.sgst_amount))
    }

    ruler(false, 1)
    sumRow(`TOTAL`, `Rs. ${fmtAmt(order.total_amount)}`, true)
    ruler(false, 1)

    y += 2
    doc.font('Helvetica').fontSize(FS_SM).text(
      `Amount in words: ${toWords(order.total_amount)}`,
      x, y, { width: CW, lineGap: 0 }
    )
    y = doc.y + 3

    if (order.notes) {
      doc.font('Helvetica').fontSize(FS_SM).text(`Notes: ${order.notes}`, x, y, { width: CW, lineGap: 0 })
      y = doc.y + 3
    }

    ruler(true, 2)

    doc.font('Helvetica').fontSize(7).text('Thank you for your purchase!', x, y, { width: CW, align: 'center', lineGap: 0 })
    y = doc.y + 1
    doc.font('Helvetica').fontSize(FS_SM).text('This is a computer-generated receipt.', x, y, { width: CW, align: 'center', lineGap: 0 })
    y = doc.y

    doc.page.height = y + MARGIN + 2
    doc.flushPages()
    doc.end()
  })
}
