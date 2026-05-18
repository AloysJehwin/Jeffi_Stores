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
  total_price: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  gst_rate: number
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
  return new Promise((resolve, reject) => {
    const W = 226
    const MARGIN = 12
    const CW = W - MARGIN * 2

    const doc = new PDFDocument({
      size: [W, 800],
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

    function text(str: string, opts: Record<string, unknown> = {}, fontSize = 8) {
      doc.fontSize(fontSize).text(str, x, y, { width: CW, ...opts })
      y = doc.y
    }

    function bold(str: string, opts: Record<string, unknown> = {}, fontSize = 8) {
      doc.font('Helvetica-Bold').fontSize(fontSize).text(str, x, y, { width: CW, ...opts })
      doc.font('Helvetica')
      y = doc.y
    }

    function line(extra = 2) {
      y += extra
      doc.moveTo(x, y).lineTo(x + CW, y).lineWidth(0.5).stroke('#000')
      y += extra
    }

    function dline(extra = 2) {
      y += extra
      doc.moveTo(x, y).lineTo(x + CW, y).lineWidth(0.3).dash(2, { space: 1 }).stroke('#000').undash()
      y += extra
    }

    doc.font('Helvetica')

    bold(business.tradeName || business.legalName, { align: 'center' }, 10)
    y += 1
    text(business.address, { align: 'center' }, 7)
    if (business.phone) text(`Ph: ${business.phone}`, { align: 'center' }, 7)
    if (business.gstin) text(`GSTIN: ${business.gstin}`, { align: 'center' }, 7)

    line()

    bold('CASH SALE RECEIPT', { align: 'center' }, 9)
    y += 2

    const labelW = 60
    const valX = x + labelW

    function row(label: string, val: string, fs = 7.5) {
      const rowY = y
      doc.font('Helvetica').fontSize(fs).text(label, x, rowY, { width: labelW })
      doc.font('Helvetica').fontSize(fs).text(val, valX, rowY, { width: CW - labelW })
      y = doc.y + 1
    }

    row('Receipt No.', order.invoice_number)
    row('Date', fmtDate(order.invoice_date))
    row('Payment', order.payment_mode || 'Cash')
    if (order.customer_name && order.customer_name.toLowerCase() !== 'walk-in customer') {
      row('Customer', order.customer_name)
    }

    dline()

    const col = {
      item: x,
      qty: x + CW - 70,
      rate: x + CW - 46,
      amt: x + CW - 22,
    }
    const colW = {
      item: CW - 70,
      qty: 24,
      rate: 24,
      amt: 22,
    }

    doc.font('Helvetica-Bold').fontSize(7)
    doc.text('Item', col.item, y, { width: colW.item })
    doc.text('Qty', col.qty, y, { width: colW.qty, align: 'right' })
    doc.text('Rate', col.rate, y, { width: colW.rate, align: 'right' })
    doc.text('Amt', col.amt, y, { width: colW.amt, align: 'right' })
    doc.font('Helvetica')
    y = doc.y + 1

    dline(1)

    for (const item of items) {
      const rowY = y
      doc.font('Helvetica').fontSize(7).text(item.product_name, col.item, rowY, { width: colW.item })
      const itemH = doc.heightOfString(item.product_name, { width: colW.item })
      const numY = rowY + Math.max(0, (itemH - 9) / 2)
      doc.text(String(item.quantity), col.qty, numY, { width: colW.qty, align: 'right' })
      doc.text(fmtAmt(item.unit_price), col.rate, numY, { width: colW.rate, align: 'right' })
      doc.text(fmtAmt(item.total_price), col.amt, numY, { width: colW.amt, align: 'right' })
      y = rowY + itemH + 2
    }

    dline(1)

    function summaryRow(label: string, val: string, isBold = false) {
      const rowY = y
      if (isBold) {
        doc.font('Helvetica-Bold').fontSize(7.5).text(label, x, rowY, { width: CW - 40 })
        doc.font('Helvetica-Bold').fontSize(7.5).text(val, x + CW - 40, rowY, { width: 40, align: 'right' })
        doc.font('Helvetica')
      } else {
        doc.font('Helvetica').fontSize(7).text(label, x, rowY, { width: CW - 40 })
        doc.font('Helvetica').fontSize(7).text(val, x + CW - 40, rowY, { width: 40, align: 'right' })
      }
      y = doc.y + 1
    }

    summaryRow('Taxable Amount', fmtAmt(order.taxable_amount))

    if (order.is_igst && order.igst_amount > 0) {
      summaryRow('IGST', fmtAmt(order.igst_amount))
    } else {
      if (order.cgst_amount > 0) summaryRow('CGST', fmtAmt(order.cgst_amount))
      if (order.sgst_amount > 0) summaryRow('SGST', fmtAmt(order.sgst_amount))
    }

    line(1)
    summaryRow('TOTAL', `Rs. ${fmtAmt(order.total_amount)}`, true)
    line(1)

    y += 2
    doc.font('Helvetica').fontSize(6.5).text(
      `Amount in words: ${toWords(order.total_amount)}`,
      x, y, { width: CW }
    )
    y = doc.y + 4

    if (order.notes) {
      doc.font('Helvetica').fontSize(6.5).text(`Notes: ${order.notes}`, x, y, { width: CW })
      y = doc.y + 4
    }

    dline()

    doc.font('Helvetica').fontSize(7).text('Thank you for your purchase!', x, y, { width: CW, align: 'center' })
    y = doc.y + 2
    doc.font('Helvetica').fontSize(6).text('This is a computer-generated receipt.', x, y, { width: CW, align: 'center' })
    y = doc.y

    doc.page.height = y + MARGIN + 4
    doc.flushPages()
    doc.end()
  })
}
