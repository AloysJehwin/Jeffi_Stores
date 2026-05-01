import path from 'path'
const PDFDocument = eval('require')('pdfkit')

export interface QuotationBusiness {
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

export interface QuotationItem {
  description: string
  hsn_code: string | null
  gst_rate: number
  quantity: number
  unit: string
  rate: number
  discount_pct: number
  amount: number
}

export interface QuotationData {
  quote_number: string
  quote_date: string
  consignee_name: string
  consignee_addr1: string
  consignee_addr2: string | null
  consignee_city: string
  consignee_state: string
  consignee_gstin: string | null
  buyer_same: boolean
  buyer_name: string
  buyer_addr1: string
  buyer_addr2: string | null
  buyer_city: string
  buyer_state: string
  buyer_gstin: string | null
  notes: string | null
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
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`
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

export function generateQuotationPDF(
  data: QuotationData,
  items: QuotationItem[],
  business: QuotationBusiness
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const LM = 28
    const pw = 595.28 - 56
    const R = LM + pw
    const F = 'Helvetica'
    const FB = 'Helvetica-Bold'
    const FBI = 'Helvetica-BoldOblique'
    const pageH = 841.89
    const bottomMargin = 28
    const pageBottom = pageH - bottomMargin

    let y = 28

    // ── Title ──────────────────────────────────────────────────────────────
    doc.font(FB).fontSize(14).text('Quotation', LM, y, { width: pw, align: 'center' })
    y += 20

    // ── Header: Logo + Seller | Meta grid ──────────────────────────────────
    const topY = y
    // Seller block is 55% of page width; meta block is 45%
    const sellerW = Math.round(pw * 0.55)
    const metaX = LM + sellerW
    const metaW = pw - sellerW

    // Logo: 28×28 px, left-padded 3, vertically centred in first ~30px
    const logoPath = path.join(process.cwd(), 'public', 'images', 'logo.png')
    const logoSize = 28
    const logoX = LM + 3
    const logoY = topY + 3
    try {
      doc.image(logoPath, logoX, logoY, { width: logoSize, height: logoSize })
    } catch { /* logo missing — skip */ }

    // Business name + address to the right of logo
    const bizX = logoX + logoSize + 4
    const bizW = sellerW - logoSize - 10
    let sy = topY + 3
    doc.font(FB).fontSize(9).text(business.tradeName.toUpperCase(), bizX, sy, { width: bizW })
    sy += 12
    doc.font(F).fontSize(7)
    const addrLines = business.address.split(',').map((s: string) => s.trim())
    for (const line of addrLines) {
      doc.text(line, bizX, sy, { width: bizW })
      sy += 9
    }
    doc.text(`GSTIN/UIN: ${business.gstin}`, bizX, sy, { width: bizW })
    sy += 9
    doc.text(`State Name : ${business.state}, Code : ${business.stateCode}`, bizX, sy, { width: bizW })
    sy += 9
    if (business.email) {
      doc.text(`E-Mail : ${business.email}`, bizX, sy, { width: bizW })
      sy += 9
    }

    // Meta grid — 3-column first row (Invoice No | e-Way Bill No | Dated)
    // then 2-column rows below
    const metaRowH = 16
    const col3W = Math.round(metaW / 3)   // Invoice No column
    const col3bW = Math.round(metaW / 3)  // e-Way Bill No column
    const col3cW = metaW - col3W - col3bW // Dated column
    const halfW = Math.round(metaW / 2)
    const halfW2 = metaW - halfW

    let my = topY

    // Row 1: Invoice No | e-Way Bill No | Dated
    drawRect(doc, metaX, my, col3W, metaRowH)
    drawRect(doc, metaX + col3W, my, col3bW, metaRowH)
    drawRect(doc, metaX + col3W + col3bW, my, col3cW, metaRowH)
    doc.font(F).fontSize(6).text('Invoice No.', metaX + 2, my + 2, { width: col3W - 4 })
    doc.font(FB).fontSize(7).text(data.quote_number, metaX + 2, my + 8, { width: col3W - 4 })
    doc.font(F).fontSize(6).text('e-Way Bill No.', metaX + col3W + 2, my + 2, { width: col3bW - 4 })
    doc.font(F).fontSize(6).text('Dated', metaX + col3W + col3bW + 2, my + 2, { width: col3cW - 4 })
    doc.font(FB).fontSize(7).text(formatDate(data.quote_date), metaX + col3W + col3bW + 2, my + 8, { width: col3cW - 4 })
    my += metaRowH

    // Row 2: Delivery Note | Mode/Terms of Payment
    drawRect(doc, metaX, my, halfW, metaRowH)
    drawRect(doc, metaX + halfW, my, halfW2, metaRowH)
    doc.font(F).fontSize(6).text('Delivery Note', metaX + 2, my + 2, { width: halfW - 4 })
    doc.font(F).fontSize(6).text('Mode/Terms of Payment', metaX + halfW + 2, my + 2, { width: halfW2 - 4 })
    my += metaRowH

    // Row 3: Reference No. & Date | Other References
    drawRect(doc, metaX, my, halfW, metaRowH)
    drawRect(doc, metaX + halfW, my, halfW2, metaRowH)
    doc.font(F).fontSize(6).text('Reference No. & Date.', metaX + 2, my + 2, { width: halfW - 4 })
    doc.font(F).fontSize(6).text('Other References', metaX + halfW + 2, my + 2, { width: halfW2 - 4 })
    my += metaRowH

    // Row 4: Buyer's Order No | Dated
    drawRect(doc, metaX, my, halfW, metaRowH)
    drawRect(doc, metaX + halfW, my, halfW2, metaRowH)
    doc.font(F).fontSize(6).text("Buyer's Order No.", metaX + 2, my + 2, { width: halfW - 4 })
    doc.font(F).fontSize(6).text('Dated', metaX + halfW + 2, my + 2, { width: halfW2 - 4 })
    my += metaRowH

    // Row 5: Dispatch Doc No | Delivery Note Date
    drawRect(doc, metaX, my, halfW, metaRowH)
    drawRect(doc, metaX + halfW, my, halfW2, metaRowH)
    doc.font(F).fontSize(6).text('Dispatch Doc No.', metaX + 2, my + 2, { width: halfW - 4 })
    doc.font(F).fontSize(6).text('Delivery Note Date', metaX + halfW + 2, my + 2, { width: halfW2 - 4 })
    my += metaRowH

    // Row 6: Dispatched through | Destination
    drawRect(doc, metaX, my, halfW, metaRowH)
    drawRect(doc, metaX + halfW, my, halfW2, metaRowH)
    doc.font(F).fontSize(6).text('Dispatched through', metaX + 2, my + 2, { width: halfW - 4 })
    doc.font(F).fontSize(6).text('Destination', metaX + halfW + 2, my + 2, { width: halfW2 - 4 })
    my += metaRowH

    // Row 7: Terms of Delivery (full width)
    drawRect(doc, metaX, my, metaW, metaRowH)
    doc.font(F).fontSize(6).text('Terms of Delivery', metaX + 2, my + 2, { width: metaW - 4 })
    my += metaRowH

    const sellerEndY = Math.max(sy + 4, my)
    drawRect(doc, LM, topY, sellerW, sellerEndY - topY)
    y = sellerEndY

    // ── Address blocks ────────────────────────────────────────────────────
    function renderAddressBlock(
      label: string,
      name: string, addr1: string, addr2: string | null,
      city: string, state: string, gstin: string | null
    ): number {
      const startY = y
      const addrW = pw * 0.55
      const rightX = LM + addrW
      const rightW = pw - addrW

      let ay = startY + 2
      doc.font(F).fontSize(6.5).text(label, LM + 3, ay, { width: addrW - 6 })
      ay += 9

      doc.font(FB).fontSize(8).text(name, LM + 3, ay, { width: addrW - 6 })
      ay += 11

      doc.font(F).fontSize(7.5)
      if (addr1) { doc.text(addr1, LM + 3, ay, { width: addrW - 6 }); ay += 10 }
      if (addr2) { doc.text(addr2, LM + 3, ay, { width: addrW - 6 }); ay += 10 }
      if (city) { doc.text(city, LM + 3, ay, { width: addrW - 6 }); ay += 10 }

      if (gstin) {
        doc.font(F).fontSize(7).text(`GSTIN/UIN : ${gstin}`, LM + 3, ay, { width: addrW - 6 })
        ay += 9
      }
      const stateCode = getStateCode(state)
      doc.font(F).fontSize(7).text(
        `State Name : ${state}${stateCode ? ', Code : ' + stateCode : ''}`,
        LM + 3, ay, { width: addrW - 6 }
      )
      ay += 10

      const blockH = ay - startY + 2
      drawRect(doc, LM, startY, pw, blockH)
      // vertical divider splitting address left / right meta columns
      drawVLine(doc, rightX, startY, startY + blockH)
      return startY + blockH
    }

    const consigneeAddr = {
      name: data.consignee_name,
      addr1: data.consignee_addr1,
      addr2: data.consignee_addr2,
      city: data.consignee_city,
      state: data.consignee_state,
      gstin: data.consignee_gstin,
    }

    y = renderAddressBlock(
      'Consignee (Ship to)',
      consigneeAddr.name, consigneeAddr.addr1, consigneeAddr.addr2,
      consigneeAddr.city, consigneeAddr.state, consigneeAddr.gstin
    )

    const buyerAddr = data.buyer_same ? consigneeAddr : {
      name: data.buyer_name,
      addr1: data.buyer_addr1,
      addr2: data.buyer_addr2,
      city: data.buyer_city,
      state: data.buyer_state,
      gstin: data.buyer_gstin,
    }

    y = renderAddressBlock(
      'Buyer (Bill to)',
      buyerAddr.name, buyerAddr.addr1, buyerAddr.addr2,
      buyerAddr.city, buyerAddr.state, buyerAddr.gstin
    )

    // ── Item table ────────────────────────────────────────────────────────
    // Column raw widths (will be scaled to page width)
    const itemColDefs = [
      { label: 'Sl\nNo.', w: 20,  align: 'center' as const },
      { label: 'Description of Goods', w: 168, align: 'left'   as const },
      { label: 'HSN/SAC',              w: 44,  align: 'center' as const },
      { label: 'Quantity',             w: 52,  align: 'right'  as const },
      { label: 'Rate',                 w: 60,  align: 'right'  as const },
      { label: 'per',                  w: 28,  align: 'center' as const },
      { label: 'Disc. %',              w: 36,  align: 'center' as const },
      { label: 'Amount',               w: 60,  align: 'right'  as const },
    ]
    const rawSum = itemColDefs.reduce((s, c) => s + c.w, 0)
    const sc = pw / rawSum
    const itemCols = itemColDefs.map((c, i) => ({ ...c, w: Math.round(c.w * sc) }))
    // fix rounding
    itemCols[itemCols.length - 1].w += pw - itemCols.reduce((s, c) => s + c.w, 0)

    const amountColW = itemCols[7].w
    const amountColX = R - amountColW
    // x position of description column start (for CGST/SGST label placement)
    const descColX = LM + itemCols[0].w

    const headerH = 20
    const rowH = 14

    // totals
    const subtotal = items.reduce((s, i) => s + i.amount, 0)
    const cgst = items.reduce((s, i) => s + i.amount * i.gst_rate / 200, 0)
    const sgst = cgst
    const rawTotalAmt = subtotal + cgst + sgst
    const totalAmt = Math.round(rawTotalAmt)
    const roundOff = totalAmt - rawTotalAmt

    const summaryRowCount = 1 + 2 + (Math.abs(roundOff) >= 0.005 ? 1 : 0) + 1
    const summaryHeight = summaryRowCount * rowH + 4

    let tableTop = y

    function drawTableHeader() {
      let cx = LM
      doc.font(FB).fontSize(6.5)
      for (const col of itemCols) {
        drawRect(doc, cx, y, col.w, headerH)
        doc.text(col.label, cx + 2, y + (col.label.includes('\n') ? 3 : 6), { width: col.w - 4, align: col.align })
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

    function checkPageBreak(needed: number) {
      if (y + needed > pageBottom) {
        closeTableSegment()
        doc.addPage()
        y = LM
        tableTop = y
        drawTableHeader()
      }
    }

    drawTableHeader()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const isLast = i === items.length - 1
      checkPageBreak(isLast ? rowH + summaryHeight : rowH)

      const disc = item.discount_pct > 0 ? `${Number(item.discount_pct).toFixed(0)} %` : ''
      const qtyStr = `${Number(item.quantity).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${item.unit}`

      const rowData = [
        String(i + 1),
        item.description,
        item.hsn_code || '',
        qtyStr,
        Number(item.rate).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
        item.unit,
        disc,
        fmt(item.amount),
      ]
      let cx = LM
      for (let j = 0; j < itemCols.length; j++) {
        const col = itemCols[j]
        // description (col 1), quantity (col 3), amount (col 7) are bold like the sample
        const isBold = j === 1 || j === 3 || j === 7
        doc.font(isBold ? FB : F).fontSize(7)
        doc.text(rowData[j], cx + 2, y + 3, { width: col.w - 4, align: col.align, lineBreak: false })
        cx += col.w
      }
      y += rowH
    }

    // Subtotal row
    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(FB).fontSize(7).text(
      fmt(subtotal),
      amountColX + 2, y + 3, { width: amountColW - 4, align: 'right' }
    )
    y += rowH

    // CGST row — label right-aligned into description col, bold italic
    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(FBI).fontSize(7.5).text('CGST', descColX + 2, y + 3,
      { width: amountColX - descColX - 8, align: 'right' })
    doc.font(F).fontSize(7).text(fmt(cgst), amountColX + 2, y + 3,
      { width: amountColW - 4, align: 'right' })
    y += rowH

    // SGST row
    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(FBI).fontSize(7.5).text('SGST', descColX + 2, y + 3,
      { width: amountColX - descColX - 8, align: 'right' })
    doc.font(F).fontSize(7).text(fmt(sgst), amountColX + 2, y + 3,
      { width: amountColW - 4, align: 'right' })
    y += rowH

    // Round Off row (only if non-trivial)
    if (Math.abs(roundOff) >= 0.005) {
      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(7.5).text('ROUND OFF', descColX + 2, y + 3,
        { width: amountColX - descColX - 8, align: 'right' })
      doc.font(F).fontSize(7).text(fmt(roundOff), amountColX + 2, y + 3,
        { width: amountColW - 4, align: 'right' })
      y += rowH
    }

    // Total row — taller, with ₹ symbol, bold
    checkPageBreak(20)
    drawHLine(doc, LM, R, y)
    // "Total" label right-aligned before amount column
    doc.font(FB).fontSize(8).text('Total', descColX + 2, y + 4,
      { width: amountColX - descColX - 8, align: 'right' })
    doc.font(FB).fontSize(9).text(`₹ ${fmt(totalAmt)}`, amountColX + 2, y + 3,
      { width: amountColW - 4, align: 'right' })
    y += 20

    closeTableSegment()

    // ── Amount in words ───────────────────────────────────────────────────
    const wordsY = y
    doc.font(F).fontSize(6.5).text('Amount Chargeable (in words)', LM + 3, y + 2)
    doc.font(F).fontSize(7).text('E. & O.E', R - 55, y + 2, { width: 53, align: 'right' })
    y += 11
    doc.font(FB).fontSize(8).text(`INR ${numberToWords(totalAmt)} Only`, LM + 3, y)
    y += 14
    drawRect(doc, LM, wordsY, pw, y - wordsY)

    // ── HSN summary table ─────────────────────────────────────────────────
    if (y + 60 > pageBottom) { doc.addPage(); y = LM }
    const hsnY = y

    // Build HSN map
    const hsnMap = new Map<string, { taxable: number; gstRate: number; cgstAmt: number; sgstAmt: number }>()
    for (const item of items) {
      const key = (item.hsn_code || 'N/A') + '__' + item.gst_rate
      const ex = hsnMap.get(key) || { taxable: 0, gstRate: item.gst_rate, cgstAmt: 0, sgstAmt: 0 }
      ex.taxable += item.amount
      ex.cgstAmt += item.amount * item.gst_rate / 200
      ex.sgstAmt += item.amount * item.gst_rate / 200
      hsnMap.set(key, ex)
    }

    // HSN table columns (raw widths, scaled)
    const hsnDefs = [
      { label: 'HSN/SAC',         w: 130, align: 'left'  as const },
      { label: 'Taxable\nValue',  w: 85,  align: 'right' as const },
      { label: 'Rate',            w: 35,  align: 'center' as const },
      { label: 'Amount',          w: 65,  align: 'right' as const },
      { label: 'Rate',            w: 35,  align: 'center' as const },
      { label: 'Amount',          w: 65,  align: 'right' as const },
      { label: 'Total\nTax Amount', w: 65, align: 'right' as const },
    ]
    const hsnRawSum = hsnDefs.reduce((s, c) => s + c.w, 0)
    const hsnSc = pw / hsnRawSum
    const hsnCols = hsnDefs.map(c => ({ ...c, w: Math.round(c.w * hsnSc) }))
    hsnCols[hsnCols.length - 1].w += pw - hsnCols.reduce((s, c) => s + c.w, 0)

    const hsnH1 = 11  // top sub-header row height
    const hsnH2 = 11  // bottom sub-header row height
    let cx = LM

    // Header row 1: HSN/SAC | Taxable Value | CGST (span) | SGST/UTGST (span) | Total Tax Amount
    doc.font(FB).fontSize(6.5)

    drawRect(doc, cx, y, hsnCols[0].w, hsnH1 + hsnH2)
    doc.text('HSN/SAC', cx + 2, y + (hsnH1 + hsnH2) / 2 - 3, { width: hsnCols[0].w - 4, align: 'left' })
    cx += hsnCols[0].w

    drawRect(doc, cx, y, hsnCols[1].w, hsnH1 + hsnH2)
    doc.text('Taxable\nValue', cx + 2, y + 2, { width: hsnCols[1].w - 4, align: 'right' })
    cx += hsnCols[1].w

    const cgstSpanW = hsnCols[2].w + hsnCols[3].w
    drawRect(doc, cx, y, cgstSpanW, hsnH1)
    doc.text('CGST', cx + 2, y + 3, { width: cgstSpanW - 4, align: 'center' })

    const sgstSpanW = hsnCols[4].w + hsnCols[5].w
    drawRect(doc, cx + cgstSpanW, y, sgstSpanW, hsnH1)
    doc.text('SGST/UTGST', cx + cgstSpanW + 2, y + 3, { width: sgstSpanW - 4, align: 'center' })

    drawRect(doc, cx + cgstSpanW + sgstSpanW, y, hsnCols[6].w, hsnH1 + hsnH2)
    doc.text('Total\nTax Amount', cx + cgstSpanW + sgstSpanW + 2, y + 2,
      { width: hsnCols[6].w - 4, align: 'right' })
    y += hsnH1

    // Header row 2: sub-headers for CGST and SGST columns
    cx = LM + hsnCols[0].w + hsnCols[1].w
    for (let i = 2; i <= 5; i++) {
      drawRect(doc, cx, y, hsnCols[i].w, hsnH2)
      doc.font(FB).fontSize(6.5).text(hsnCols[i].label, cx + 2, y + 3,
        { width: hsnCols[i].w - 4, align: hsnCols[i].align })
      cx += hsnCols[i].w
    }
    y += hsnH2

    // Data rows
    let hsnTotalTaxable = 0, hsnTotalCgst = 0, hsnTotalSgst = 0
    doc.font(F).fontSize(7)
    for (const [key, vals] of hsnMap) {
      const hsn = key.split('__')[0]
      const halfRate = vals.gstRate / 2
      const totalTax = vals.cgstAmt + vals.sgstAmt
      hsnTotalTaxable += vals.taxable
      hsnTotalCgst += vals.cgstAmt
      hsnTotalSgst += vals.sgstAmt
      cx = LM
      const rowData = [
        hsn,
        fmt(vals.taxable),
        `${halfRate}%`,
        fmt(vals.cgstAmt),
        `${halfRate}%`,
        fmt(vals.sgstAmt),
        fmt(totalTax),
      ]
      for (let j = 0; j < hsnCols.length; j++) {
        doc.text(rowData[j], cx + 2, y + 2, { width: hsnCols[j].w - 4, align: hsnCols[j].align })
        cx += hsnCols[j].w
      }
      y += 12
    }

    // Total row
    drawHLine(doc, LM, R, y)
    y += 1
    cx = LM
    doc.font(FB).fontSize(7)
    doc.text('Total', cx + 2, y + 2, { width: hsnCols[0].w - 4, align: 'right' })
    cx += hsnCols[0].w
    doc.text(fmt(hsnTotalTaxable), cx + 2, y + 2, { width: hsnCols[1].w - 4, align: 'right' })
    cx += hsnCols[1].w + hsnCols[2].w  // skip Rate col
    doc.text(fmt(hsnTotalCgst), cx + 2, y + 2, { width: hsnCols[3].w - 4, align: 'right' })
    cx += hsnCols[3].w + hsnCols[4].w  // skip Rate col
    doc.text(fmt(hsnTotalSgst), cx + 2, y + 2, { width: hsnCols[5].w - 4, align: 'right' })
    cx += hsnCols[5].w
    doc.text(fmt(hsnTotalCgst + hsnTotalSgst), cx + 2, y + 2, { width: hsnCols[6].w - 4, align: 'right' })
    y += 14

    drawRect(doc, LM, hsnY, pw, y - hsnY)

    // ── Tax amount in words ───────────────────────────────────────────────
    const taxWordsY = y
    const totalTaxAmt = cgst + sgst
    doc.font(F).fontSize(7).text('Tax Amount (in words) : ', LM + 3, y + 3, { continued: true })
    doc.font(FB).fontSize(7).text(`INR ${numberToWords(totalTaxAmt)} Only`)
    y += 14
    drawRect(doc, LM, taxWordsY, pw, y - taxWordsY)

    // ── Declaration + Bank Details ────────────────────────────────────────
    if (y + 110 > pageBottom) { doc.addPage(); y = LM }
    const bottomY = y
    const bottomH = 68
    const declW = Math.round(pw * 0.50)
    const bankX = LM + declW
    const bankW = pw - declW

    doc.font(FB).fontSize(7).text('Declaration', LM + 3, y + 3)
    y += 11
    doc.font(F).fontSize(6.5).text(
      'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
      LM + 3, y, { width: declW - 6 }
    )

    let by = bottomY + 3
    doc.font(F).fontSize(7).text("Company's Bank Details", bankX + 3, by, { width: bankW - 6 })
    by += 10

    // Bank details: "Label :" left, bold value right of colon
    const bankDetails = [
      { label: 'Bank Name', value: business.bankName },
      { label: 'A/c No.', value: business.bankAccount },
      { label: 'Branch & IFS Code', value: `${business.bankBranch} & ${business.bankIfsc}` },
    ]
    const labelW = 80
    const valX = bankX + labelW + 6
    const valW = bankW - labelW - 10
    for (const bd of bankDetails) {
      doc.font(F).fontSize(6.5).text(`${bd.label}  :`, bankX + 3, by, { width: labelW })
      doc.font(FB).fontSize(6.5).text(bd.value, valX, by, { width: valW })
      by += 9
    }

    y = bottomY + bottomH
    drawRect(doc, LM, bottomY, declW, bottomH)
    drawRect(doc, bankX, bottomY, bankW, bottomH)

    // Authorised signatory box
    const sigH = 30
    drawRect(doc, LM, y, declW, sigH)
    drawRect(doc, bankX, y, bankW, sigH)
    doc.font(FB).fontSize(7).text(`for ${business.tradeName.toUpperCase()}`, bankX + 2, y + 4,
      { width: bankW - 4, align: 'right' })
    doc.font(F).fontSize(7).text('Authorised Signatory', bankX + 2, y + sigH - 11,
      { width: bankW - 4, align: 'right' })
    y += sigH + 8

    // ── Footer ────────────────────────────────────────────────────────────
    doc.font(F).fontSize(7).text('SUBJECT TO RAIPUR JURISDICTION', LM, y, { width: pw, align: 'center' })
    y += 10
    doc.font(F).fontSize(6.5).text('This is a Computer Generated Invoice', LM, y, { width: pw, align: 'center' })

    doc.end()
  })
}
