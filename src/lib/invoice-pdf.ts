// eslint-disable-next-line no-eval
const PDFDocument = eval('require')('pdfkit')

export interface InvoiceBusinessSettings {
  gstin: string
  legalName: string
  tradeName: string
  address: string
  state: string
  stateCode: string
  phone: string
  email: string
  bankName: string
  bankAccount: string
  bankIfsc: string
  bankBranch: string
}

export interface InvoiceOrderItem {
  product_name: string
  hsn_code: string | null
  gst_rate: number
  quantity: number
  unit_price: number
  total_price: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
}

export interface InvoiceOrder {
  order_number: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  subtotal: number
  tax_amount: number
  total_amount: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  is_igst: boolean
  buyer_gstin: string | null
  order_date?: string
  payment_mode?: string
  tracking_number?: string
  shipped_at?: string
  shipping_method?: string
  destination?: string
}

export interface InvoiceBuyerAddress {
  full_name: string
  address_line1: string
  address_line2: string | null
  city: string
  state: string
  postal_code: string
  phone: string
}

function numberToWords(num: number): string {
  if (num === 0) return 'Zero'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function convertGroup(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convertGroup(n % 100) : '')
  }

  const crore = Math.floor(num / 10000000)
  const lakh = Math.floor((num % 10000000) / 100000)
  const thousand = Math.floor((num % 100000) / 1000)
  const remainder = Math.floor(num % 1000)
  const paise = Math.round((num - Math.floor(num)) * 100)

  let result = ''
  if (crore > 0) result += convertGroup(crore) + ' Crore '
  if (lakh > 0) result += convertGroup(lakh) + ' Lakh '
  if (thousand > 0) result += convertGroup(thousand) + ' Thousand '
  if (remainder > 0) result += convertGroup(remainder)

  result = result.trim()
  if (paise > 0) result += ' and ' + convertGroup(paise) + ' paise'
  return result
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDate()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mon = months[d.getMonth()]
  const yr = d.getFullYear().toString().slice(-2)
  return `${day}-${mon}-${yr}`
}

function getStateCode(stateName: string): string {
  const map: Record<string, string> = {
    'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
    'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
    'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
    'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
    'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23',
    'gujarat': '24', 'daman and diu': '25', 'dadra and nagar haveli': '26', 'maharashtra': '27',
    'andhra pradesh': '28', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32',
    'tamil nadu': '33', 'puducherry': '34', 'andaman and nicobar': '35', 'telangana': '36',
    'andhra pradesh (new)': '37', 'ladakh': '38',
  }
  return map[stateName.toLowerCase().trim()] || ''
}

function drawRect(doc: any, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h).stroke()
}

function drawHLine(doc: any, x1: number, x2: number, y: number) {
  doc.moveTo(x1, y).lineTo(x2, y).stroke()
}

function drawVLine(doc: any, x: number, y1: number, y2: number) {
  doc.moveTo(x, y1).lineTo(x, y2).stroke()
}

function renderAddressBlock(
  doc: any, label: string, addr: InvoiceBuyerAddress, buyerGstin: string | null,
  LM: number, pw: number, startY: number
): number {
  let y = startY
  doc.font('Helvetica').fontSize(6).text(label, LM + 3, y + 2, { width: pw - 6 })
  y += 10
  doc.font('Helvetica-Bold').fontSize(7)
  const fullAddr = [
    addr.full_name,
    addr.address_line1,
    addr.address_line2,
    addr.city,
    `${addr.state} - ${addr.postal_code}, India`,
  ].filter(Boolean).join('\n')
  doc.text(fullAddr, LM + 3, y, { width: pw * 0.55 - 6 })
  y += doc.heightOfString(fullAddr, { width: pw * 0.55 - 6 }) + 2

  const stateCode = getStateCode(addr.state)
  if (buyerGstin) {
    doc.font('Helvetica').fontSize(7).text(`GSTIN/UIN      : ${buyerGstin}`, LM + 3, y, { width: pw * 0.55 - 6 })
    y += 9
    const pan = buyerGstin.substring(2, 12)
    doc.text(`PAN/IT No       : ${pan}`, LM + 3, y, { width: pw * 0.55 - 6 })
    y += 9
  }
  doc.font('Helvetica').fontSize(7)
  doc.text(`State Name      : ${addr.state}${stateCode ? ', Code : ' + stateCode : ''}`, LM + 3, y, { width: pw * 0.55 - 6 })
  y += 9
  if (addr.phone) {
    doc.text(`Phone            : ${addr.phone}`, LM + 3, y, { width: pw * 0.55 - 6 })
    y += 9
  }
  doc.text(`Place of Supply  : ${addr.state}`, LM + 3, y, { width: pw * 0.55 - 6 })
  y += 11
  drawRect(doc, LM, startY, pw, y - startY)
  return y
}

export function generateInvoicePDF(
  order: InvoiceOrder,
  items: InvoiceOrderItem[],
  business: InvoiceBusinessSettings,
  buyerAddress: InvoiceBuyerAddress,
  billingAddress?: InvoiceBuyerAddress,
  isCancelled?: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const LM = 28
    const pw = 595.28 - 56
    const R = LM + pw
    const F = 'Helvetica'
    const FB = 'Helvetica-Bold'
    const FI = 'Helvetica-Oblique'
    const FBI = 'Helvetica-BoldOblique'

    let y = 28

    doc.font(FB).fontSize(12).text('Tax Invoice', LM, y, { width: pw, align: 'center' })
    y += 16

    const topY = y
    const sellerW = pw * 0.55
    const metaW = pw - sellerW
    const metaX = LM + sellerW
    const metaHalfW = metaW / 2

    const sellerX = LM + 3
    let sy = topY + 3
    doc.font(FB).fontSize(9).text(business.tradeName.toUpperCase(), sellerX, sy, { width: sellerW - 6 })
    sy += 11
    doc.font(F).fontSize(7)
    const addressLines = business.address.split(',').map(s => s.trim())
    const addrText = addressLines.join(',\n')
    doc.text(addrText, sellerX, sy, { width: sellerW - 6 })
    sy += doc.heightOfString(addrText, { width: sellerW - 6 }) + 2
    doc.text(`GSTIN/UIN: ${business.gstin}`, sellerX, sy, { width: sellerW - 6 })
    sy += 9
    doc.text(`State Name : ${business.state}, Code : ${business.stateCode}`, sellerX, sy, { width: sellerW - 6 })
    sy += 9
    if (business.phone || business.email) {
      if (business.phone) {
        doc.text(`Contact : ${business.phone}`, sellerX, sy, { width: sellerW - 6 })
        sy += 9
      }
    }
    if (business.email) {
      doc.text(`E-Mail : ${business.email}`, sellerX, sy, { width: sellerW - 6 })
      sy += 9
    }

    const metaRowH = 18
    const metaRows = [
      { left: 'Invoice No.', leftVal: order.invoice_number, right: 'Dated', rightVal: formatDate(order.invoice_date) },
      { left: 'Delivery Note', leftVal: order.tracking_number || '', right: 'Mode/Terms of Payment', rightVal: order.payment_mode || 'Online Payment' },
      { left: 'Reference No. & Date.', leftVal: '', right: 'Other References', rightVal: '' },
      { left: "Buyer's Order No.", leftVal: order.order_number, right: 'Dated', rightVal: order.order_date ? formatDate(order.order_date) : '' },
      { left: 'Dispatch Doc No.', leftVal: order.tracking_number || '', right: 'Delivery Note Date', rightVal: order.shipped_at ? formatDate(order.shipped_at) : '' },
      { left: 'Dispatched through', leftVal: order.shipping_method || '', right: 'Destination', rightVal: order.destination || '' },
    ]

    let my = topY
    for (const row of metaRows) {
      drawRect(doc, metaX, my, metaHalfW, metaRowH)
      drawRect(doc, metaX + metaHalfW, my, metaHalfW, metaRowH)
      doc.font(F).fontSize(6)
      doc.text(row.left, metaX + 2, my + 2, { width: metaHalfW - 4 })
      doc.text(row.right, metaX + metaHalfW + 2, my + 2, { width: metaHalfW - 4 })
      doc.font(FB).fontSize(7)
      if (row.leftVal) doc.text(row.leftVal, metaX + 2, my + 9, { width: metaHalfW - 4 })
      if (row.rightVal) doc.text(row.rightVal, metaX + metaHalfW + 2, my + 9, { width: metaHalfW - 4 })
      my += metaRowH
    }

    drawRect(doc, metaX, my, metaW, metaRowH)
    doc.font(F).fontSize(6).text('Terms of Delivery', metaX + 2, my + 2, { width: metaW - 4 })
    my += metaRowH

    const sellerEndY = Math.max(sy + 4, my)
    drawRect(doc, LM, topY, sellerW, sellerEndY - topY)
    y = sellerEndY

    y = renderAddressBlock(doc, 'Consignee (Ship to)', buyerAddress, order.buyer_gstin, LM, pw, y)

    const billAddr = billingAddress || buyerAddress
    y = renderAddressBlock(doc, 'Buyer (Bill to)', billAddr, order.buyer_gstin, LM, pw, y)

    const pageH = 841.89
    const bottomMargin = 28
    const pageBottom = pageH - bottomMargin

    const itemCols = [
      { label: 'Sl\nNo.', w: 22, align: 'center' as const },
      { label: 'Description of Goods', w: 140, align: 'left' as const },
      { label: 'HSN/SAC', w: 52, align: 'center' as const },
      { label: 'GST\nRate', w: 36, align: 'center' as const },
      { label: 'Quantity', w: 52, align: 'center' as const },
      { label: 'Rate\n(Incl. of Tax)', w: 62, align: 'right' as const },
      { label: 'Rate', w: 52, align: 'right' as const },
      { label: 'per', w: 30, align: 'center' as const },
      { label: 'Disc. %', w: 38, align: 'center' as const },
      { label: 'Amount', w: 62, align: 'right' as const },
    ]

    const rawTotal = itemCols.reduce((s, c) => s + c.w, 0)
    const colScale = pw / rawTotal
    itemCols.forEach(c => { c.w = Math.round(c.w * colScale) })
    const drift = pw - itemCols.reduce((s, c) => s + c.w, 0)
    itemCols[itemCols.length - 1].w += drift

    const headerH = 22
    const rowH = 14
    const amountColW = itemCols[itemCols.length - 1].w
    const amountColX = R - amountColW
    const descLabelX = LM + itemCols[0].w + 8

    const summaryRowsHeight = rowH + (order.is_igst ? rowH : rowH * 2) + 22

    let tableTop = y

    function drawTableHeader() {
      let cx = LM
      doc.font(FB).fontSize(6.5)
      for (const col of itemCols) {
        drawRect(doc, cx, y, col.w, headerH)
        doc.text(col.label, cx + 2, y + 3, { width: col.w - 4, align: col.align })
        cx += col.w
      }
      y += headerH
    }

    function closeTableSegment() {
      drawRect(doc, LM, tableTop, pw, y - tableTop)
      let cx = LM
      for (let i = 0; i < itemCols.length - 1; i++) {
        cx += itemCols[i].w
        drawVLine(doc, cx, tableTop, y)
      }
    }

    function checkPageBreak(neededHeight: number) {
      if (y + neededHeight > pageBottom) {
        closeTableSegment()
        doc.font(FI).fontSize(6).text('Continued on next page...', LM, y + 2, { width: pw, align: 'center' })
        doc.addPage()
        y = LM
        tableTop = y
        drawTableHeader()
      }
    }

    drawTableHeader()

    for (let i = 0; i < items.length; i++) {
      const isLastItem = i === items.length - 1
      const spaceNeeded = isLastItem ? rowH + summaryRowsHeight : rowH
      checkPageBreak(spaceNeeded)

      const item = items[i]
      const unitExcl = item.taxable_amount / item.quantity

      let cx = LM
      const rowData = [
        String(i + 1),
        item.product_name,
        item.hsn_code || '',
        `${item.gst_rate} %`,
        `${item.quantity} NOS`,
        fmt(item.unit_price),
        fmt(unitExcl),
        'NOS',
        '',
        fmt(item.taxable_amount),
      ]

      doc.font(F).fontSize(7)
      for (let j = 0; j < itemCols.length; j++) {
        const col = itemCols[j]
        if (j === 1 || j === 9) doc.font(FB).fontSize(7)
        else doc.font(F).fontSize(7)
        doc.text(rowData[j], cx + 2, y + 2, { width: col.w - 4, align: col.align })
        cx += col.w
      }
      y += rowH
    }

    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(F).fontSize(7)
    doc.text(fmt(order.taxable_amount), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += rowH

    if (order.is_igst) {
      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(8).text('IGST', descLabelX, y + 2, { width: itemCols[1].w - 12 })
      doc.font(F).fontSize(7).text(fmt(order.igst_amount), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
      y += rowH
    } else {
      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(8).text('CGST', descLabelX, y + 2, { width: itemCols[1].w - 12 })
      doc.font(F).fontSize(7).text(fmt(order.cgst_amount), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
      y += rowH

      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(8).text('SGST', descLabelX, y + 2, { width: itemCols[1].w - 12 })
      doc.font(F).fontSize(7).text(fmt(order.sgst_amount), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
      y += rowH
    }

    const roundOff = order.total_amount - (order.taxable_amount + order.cgst_amount + order.sgst_amount + order.igst_amount)
    if (Math.abs(roundOff) >= 0.01) {
      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(8).text('ROUND OFF', descLabelX, y + 2, { width: itemCols[1].w - 12 })
      doc.font(F).fontSize(7).text(fmt(roundOff), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
      y += rowH
    }

    checkPageBreak(22)
    const totalRowY = y
    drawHLine(doc, LM, R, y)
    y += 3
    doc.font(FB).fontSize(7).text('Total', LM + itemCols[0].w + 2, y + 3, { width: 40, align: 'right' })
    doc.font(FB).fontSize(9).text(`Rs. ${fmt(order.total_amount)}`, amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += 18

    drawRect(doc, LM, tableTop, pw, y - tableTop)
    let gridCx = LM
    for (let i = 0; i < itemCols.length - 1; i++) {
      gridCx += itemCols[i].w
      drawVLine(doc, gridCx, tableTop, totalRowY)
    }
    drawVLine(doc, amountColX, tableTop, y)

    function ensureSpace(needed: number) {
      if (y + needed > pageBottom) {
        doc.addPage()
        y = LM
      }
    }

    ensureSpace(26)
    const wordsY = y
    doc.font(F).fontSize(7).text('Amount Chargeable (in words)', LM + 3, y + 2)
    doc.font(F).fontSize(7).text('E. & O.E', R - 50, y + 2, { width: 48, align: 'right' })
    y += 11
    doc.font(FB).fontSize(8).text(`INR ${numberToWords(order.total_amount)} Only`, LM + 3, y)
    y += 13
    drawRect(doc, LM, wordsY, pw, y - wordsY)

    ensureSpace(60)
    let cx = LM
    const hsnY = y

    const hsnMap = new Map<string, { taxable: number; rate: number; cgst: number; sgst: number; igst: number; totalTax: number }>()
    for (const item of items) {
      const key = item.hsn_code || 'N/A'
      const ex = hsnMap.get(key) || { taxable: 0, rate: item.gst_rate, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }
      ex.taxable += item.taxable_amount
      ex.cgst += item.cgst_amount
      ex.sgst += item.sgst_amount
      ex.igst += item.igst_amount
      ex.totalTax += item.cgst_amount + item.sgst_amount + item.igst_amount
      hsnMap.set(key, ex)
    }

    const hsnCols = order.is_igst
      ? [
          { label: 'HSN/SAC', w: 160, align: 'left' as const },
          { label: 'Taxable\nValue', w: 90, align: 'right' as const },
          { label: 'IGST', w: 0, align: 'center' as const, sub: true, subCols: [
            { label: 'Rate', w: 50, align: 'center' as const },
            { label: 'Amount', w: 80, align: 'right' as const },
          ]},
          { label: 'Total\nTax Amount', w: 80, align: 'right' as const },
        ]
      : [
          { label: 'HSN/SAC', w: 130, align: 'left' as const },
          { label: 'Taxable\nValue', w: 80, align: 'right' as const },
          { label: 'CGST', w: 0, align: 'center' as const, sub: true, subCols: [
            { label: 'Rate', w: 40, align: 'center' as const },
            { label: 'Amount', w: 60, align: 'right' as const },
          ]},
          { label: 'SGST', w: 0, align: 'center' as const, sub: true, subCols: [
            { label: 'Rate', w: 40, align: 'center' as const },
            { label: 'Amount', w: 60, align: 'right' as const },
          ]},
          { label: 'Total\nTax Amount', w: 70, align: 'right' as const },
        ]

    type FlatCol = { label: string; w: number; align: 'left' | 'right' | 'center' }
    const flatCols: FlatCol[] = []
    for (const col of hsnCols) {
      if ((col as any).sub && (col as any).subCols) {
        for (const sc of (col as any).subCols) flatCols.push(sc)
      } else {
        flatCols.push({ label: col.label, w: col.w, align: col.align })
      }
    }
    const hsnRawTotal = flatCols.reduce((s, c) => s + c.w, 0)
    const hsnSc = pw / hsnRawTotal
    flatCols.forEach(c => { c.w = Math.round(c.w * hsnSc) })
    flatCols[flatCols.length - 1].w += pw - flatCols.reduce((s, c) => s + c.w, 0)

    const hsnHeaderH1 = 12
    const hsnHeaderH2 = 12
    cx = LM
    doc.font(FB).fontSize(6.5)

    let flatIdx = 0
    for (const col of hsnCols) {
      if ((col as any).sub && (col as any).subCols) {
        let actualSubW = 0
        for (const _sc of (col as any).subCols) {
          actualSubW += flatCols[flatIdx].w
          flatIdx++
        }
        drawRect(doc, cx, y, actualSubW, hsnHeaderH1)
        doc.text(col.label, cx + 2, y + 3, { width: actualSubW - 4, align: 'center' })
        cx += actualSubW
      } else {
        drawRect(doc, cx, y, flatCols[flatIdx].w, hsnHeaderH1 + hsnHeaderH2)
        doc.text(col.label, cx + 2, y + 3, { width: flatCols[flatIdx].w - 4, align: col.align })
        cx += flatCols[flatIdx].w
        flatIdx++
      }
    }
    y += hsnHeaderH1

    cx = LM
    flatIdx = 0
    for (const col of hsnCols) {
      if ((col as any).sub && (col as any).subCols) {
        for (const sc of (col as any).subCols) {
          drawRect(doc, cx, y, flatCols[flatIdx].w, hsnHeaderH2)
          doc.font(FB).fontSize(6.5).text(sc.label, cx + 2, y + 3, { width: flatCols[flatIdx].w - 4, align: sc.align })
          cx += flatCols[flatIdx].w
          flatIdx++
        }
      } else {
        cx += flatCols[flatIdx].w
        flatIdx++
      }
    }
    y += hsnHeaderH2

    let hsnTotalTaxable = 0
    let hsnTotalTax = 0
    doc.font(F).fontSize(7)
    for (const [hsn, vals] of hsnMap) {
      cx = LM
      hsnTotalTaxable += vals.taxable
      hsnTotalTax += vals.totalTax

      let rowData: string[]
      if (order.is_igst) {
        rowData = [hsn, fmt(vals.taxable), `${vals.rate}%`, fmt(vals.igst), fmt(vals.totalTax)]
      } else {
        rowData = [hsn, fmt(vals.taxable), `${vals.rate / 2}%`, fmt(vals.cgst), `${vals.rate / 2}%`, fmt(vals.sgst), fmt(vals.totalTax)]
      }

      for (let j = 0; j < flatCols.length; j++) {
        doc.text(rowData[j] || '', cx + 2, y + 2, { width: flatCols[j].w - 4, align: flatCols[j].align })
        cx += flatCols[j].w
      }
      y += 12
    }

    drawHLine(doc, LM, R, y)
    y += 1
    cx = LM
    doc.font(FB).fontSize(7)

    doc.text('Total', cx + 2, y + 2, { width: flatCols[0].w - 4, align: 'right' })
    cx += flatCols[0].w
    doc.text(fmt(hsnTotalTaxable), cx + 2, y + 2, { width: flatCols[1].w - 4, align: 'right' })
    cx += flatCols[1].w

    if (order.is_igst) {
      cx += flatCols[2].w
      doc.text(fmt(order.igst_amount), cx + 2 - flatCols[3].w, y + 2, { width: flatCols[3].w - 4, align: 'right' })
      cx = LM + flatCols.reduce((s, c) => s + c.w, 0) - flatCols[flatCols.length - 1].w
    } else {
      cx += flatCols[2].w
      doc.text(fmt(order.cgst_amount), cx + 2, y + 2, { width: flatCols[3].w - 4, align: 'right' })
      cx += flatCols[3].w + flatCols[4].w
      doc.text(fmt(order.sgst_amount), cx + 2, y + 2, { width: flatCols[5].w - 4, align: 'right' })
      cx += flatCols[5].w
    }
    const lastColX = R - flatCols[flatCols.length - 1].w
    doc.text(fmt(hsnTotalTax), lastColX + 2, y + 2, { width: flatCols[flatCols.length - 1].w - 4, align: 'right' })
    y += 14

    drawRect(doc, LM, hsnY, pw, y - hsnY)

    const taxWordsY = y
    const totalTaxAmount = order.is_igst ? order.igst_amount : (order.cgst_amount + order.sgst_amount)
    doc.font(F).fontSize(7)
    doc.text('Tax Amount (in words) :', LM + 3, y + 3, { continued: true })
    doc.font(FB).fontSize(7)
    doc.text(`  INR ${numberToWords(totalTaxAmount)} Only`)
    y += 14
    drawRect(doc, LM, taxWordsY, pw, y - taxWordsY)

    ensureSpace(110)
    const bottomY = y
    const bottomH = 70
    const declW = pw * 0.48
    const bankW = pw - declW

    doc.font(FB).fontSize(7).text('Declaration', LM + 3, y + 3, { width: declW - 6 })
    y += 10
    doc.font(F).fontSize(6.5)
    doc.text('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', LM + 3, y, { width: declW - 6 })

    const bankX = LM + declW
    let by = bottomY + 3
    doc.font(F).fontSize(7)
    doc.text("Company's Bank Details", bankX + 2, by, { width: bankW - 4 })
    by += 10
    const bankLabelW = 90
    const bankValX = bankX + bankLabelW + 10
    const bankValW = bankW - bankLabelW - 14
    const bankDetails = [
      { label: "A/c Holder's Name", value: business.tradeName.toUpperCase() },
      { label: 'Bank Name', value: business.bankName.toUpperCase() },
      { label: 'A/c No.', value: business.bankAccount },
      { label: 'Branch & IFS Code', value: `${business.bankBranch} & ${business.bankIfsc}` },
    ]
    for (const bd of bankDetails) {
      doc.font(F).fontSize(6.5).text(`${bd.label}  :`, bankX + 2, by, { width: bankLabelW })
      doc.font(FB).fontSize(6.5).text(bd.value, bankValX, by, { width: bankValW })
      by += 9
    }

    y = bottomY + bottomH

    drawRect(doc, LM, bottomY, declW, bottomH)
    drawRect(doc, bankX, bottomY, bankW, bottomH)

    const sigY = y
    const sigH = 30
    drawRect(doc, LM, sigY, declW, sigH)
    drawRect(doc, LM + declW, sigY, bankW, sigH)

    doc.font(F).fontSize(7).text("Customer's Seal and Signature", LM + 3, sigY + 3)
    doc.font(FB).fontSize(7).text(`for ${business.tradeName.toUpperCase()}`, LM + declW + 2, sigY + 3, { width: bankW - 4, align: 'right' })
    doc.font(F).fontSize(7).text('Authorised Signatory', LM + declW + 2, sigY + sigH - 12, { width: bankW - 4, align: 'right' })

    y = sigY + sigH + 8

    doc.font(F).fontSize(7).text('SUBJECT TO RAIPUR JURISDICTION', LM, y, { width: pw, align: 'center' })
    y += 10
    doc.font(F).fontSize(6.5).text('This is a Computer Generated Invoice', LM, y, { width: pw, align: 'center' })

    if (isCancelled) {
      const pageW = 595.28
      const pageH = 841.89
      const cx = pageW / 2
      const cy = pageH / 2
      doc.save()
      doc.translate(cx, cy)
      doc.rotate(-45)
      doc.strokeColor('#cc0000').lineWidth(3).rect(-160, -42, 320, 84).stroke()
      doc.font('Helvetica-Bold').fontSize(64).fillColor('#cc0000').fillOpacity(0.18)
      doc.text('CANCELLED', -160, -30, { width: 320, align: 'center', lineBreak: false })
      doc.restore()
    }

    doc.end()
  })
}
