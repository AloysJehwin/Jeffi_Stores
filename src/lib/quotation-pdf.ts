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

function fmtTotal(amount: number): string {
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

interface AddressBlock {
  name: string
  addr1: string
  addr2: string | null
  city: string
  state: string
  gstin: string | null
}

function renderAddressBlock(
  doc: any, label: string, addr: AddressBlock,
  LM: number, pw: number, startY: number
): number {
  let y = startY
  doc.font('Helvetica').fontSize(6).text(label, LM + 3, y + 2, { width: pw - 6 })
  y += 10
  doc.font('Helvetica-Bold').fontSize(7)
  const lines = [addr.name, addr.addr1, addr.addr2, addr.city].filter(Boolean)
  const addrText = lines.join('\n')
  doc.text(addrText, LM + 3, y, { width: pw * 0.55 - 6 })
  y += doc.heightOfString(addrText, { width: pw * 0.55 - 6 }) + 2
  const stateCode = getStateCode(addr.state)
  if (addr.gstin) {
    doc.font('Helvetica').fontSize(7).text(`GSTIN/UIN : ${addr.gstin}`, LM + 3, y, { width: pw * 0.55 - 6 })
    y += 9
  }
  doc.font('Helvetica').fontSize(7).text(`State Name : ${addr.state}${stateCode ? ', Code : ' + stateCode : ''}`, LM + 3, y, { width: pw * 0.55 - 6 })
  y += 11
  drawRect(doc, LM, startY, pw, y - startY)
  return y
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

    doc.font(FB).fontSize(12).text('Quotation', LM, y, { width: pw, align: 'center' })
    y += 16

    const topY = y
    const sellerW = pw * 0.55
    const metaW = pw - sellerW
    const metaX = LM + sellerW
    const metaHalfW = metaW / 2

    let sy = topY + 3
    const sellerX = LM + 3
    doc.font(FB).fontSize(9).text(business.tradeName.toUpperCase(), sellerX, sy, { width: sellerW - 6 })
    sy += 11
    doc.font(F).fontSize(7)
    const addrText = business.address.split(',').map((s: string) => s.trim()).join(',\n')
    doc.text(addrText, sellerX, sy, { width: sellerW - 6 })
    sy += doc.heightOfString(addrText, { width: sellerW - 6 }) + 2
    doc.text(`GSTIN/UIN: ${business.gstin}`, sellerX, sy, { width: sellerW - 6 })
    sy += 9
    doc.text(`State Name : ${business.state}, Code : ${business.stateCode}`, sellerX, sy, { width: sellerW - 6 })
    sy += 9
    if (business.email) {
      doc.text(`E-Mail : ${business.email}`, sellerX, sy, { width: sellerW - 6 })
      sy += 9
    }

    const metaRowH = 18
    const metaRows = [
      { left: 'Invoice No.', leftVal: data.quote_number, right: 'e-Way Bill No.', rightVal: '' },
      { left: 'Dated', leftVal: formatDate(data.quote_date), right: '', rightVal: '' },
      { left: 'Delivery Note', leftVal: '', right: 'Mode/Terms of Payment', rightVal: '' },
      { left: 'Reference No. & Date.', leftVal: '', right: 'Other References', rightVal: '' },
      { left: "Buyer's Order No.", leftVal: '', right: 'Dated', rightVal: '' },
      { left: 'Dispatch Doc No.', leftVal: '', right: 'Delivery Note Date', rightVal: '' },
      { left: 'Dispatched through', leftVal: '', right: 'Destination', rightVal: '' },
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

    const consigneeAddr: AddressBlock = {
      name: data.consignee_name,
      addr1: data.consignee_addr1,
      addr2: data.consignee_addr2,
      city: data.consignee_city,
      state: data.consignee_state,
      gstin: data.consignee_gstin,
    }
    y = renderAddressBlock(doc, 'Consignee (Ship to)', consigneeAddr, LM, pw, y)

    const buyerAddr: AddressBlock = data.buyer_same ? consigneeAddr : {
      name: data.buyer_name,
      addr1: data.buyer_addr1,
      addr2: data.buyer_addr2,
      city: data.buyer_city,
      state: data.buyer_state,
      gstin: data.buyer_gstin,
    }
    y = renderAddressBlock(doc, 'Buyer (Bill to)', buyerAddr, LM, pw, y)

    const itemCols = [
      { label: 'Sl\nNo.', w: 22, align: 'center' as const },
      { label: 'Description of Goods', w: 160, align: 'left' as const },
      { label: 'HSN/SAC', w: 52, align: 'center' as const },
      { label: 'Quantity', w: 52, align: 'center' as const },
      { label: 'Rate', w: 62, align: 'right' as const },
      { label: 'per', w: 30, align: 'center' as const },
      { label: 'Disc. %', w: 38, align: 'center' as const },
      { label: 'Amount', w: 62, align: 'right' as const },
    ]
    const rawTotal = itemCols.reduce((s, c) => s + c.w, 0)
    const colScale = pw / rawTotal
    itemCols.forEach(c => { c.w = Math.round(c.w * colScale) })
    itemCols[itemCols.length - 1].w += pw - itemCols.reduce((s, c) => s + c.w, 0)

    const headerH = 22
    const rowH = 14
    const amountColW = itemCols[itemCols.length - 1].w
    const amountColX = R - amountColW
    const descLabelX = LM + itemCols[0].w + 8

    const subtotal = items.reduce((s, i) => s + i.amount, 0)
    const cgst = items.reduce((s, i) => s + i.amount * i.gst_rate / 200, 0)
    const sgst = cgst
    const rawTotalAmt = subtotal + cgst + sgst
    const totalAmt = Math.round(rawTotalAmt)
    const roundOff = totalAmt - rawTotalAmt

    const summaryRows = 1 + 2 + (Math.abs(roundOff) >= 0.005 ? 1 : 0) + 1
    const summaryHeight = summaryRows * rowH

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

    function checkPageBreak(needed: number) {
      if (y + needed > pageBottom) {
        closeTableSegment()
        doc.font('Helvetica-Oblique').fontSize(6).text('Continued on next page...', LM, y + 2, { width: pw, align: 'center' })
        doc.addPage()
        y = LM
        tableTop = y
        drawTableHeader()
      }
    }

    drawTableHeader()

    for (let i = 0; i < items.length; i++) {
      const isLast = i === items.length - 1
      checkPageBreak(isLast ? rowH + summaryHeight : rowH)
      const item = items[i]
      const disc = item.discount_pct > 0 ? `${Number(item.discount_pct).toFixed(0)} %` : ''
      const rowData = [
        String(i + 1),
        item.description,
        item.hsn_code || '',
        `${Number(item.quantity).toFixed(3)} ${item.unit}`,
        Number(item.rate).toFixed(4),
        item.unit,
        disc,
        fmt(item.amount),
      ]
      let cx = LM
      for (let j = 0; j < itemCols.length; j++) {
        const col = itemCols[j]
        doc.font(j === 1 ? FB : F).fontSize(7)
        doc.text(rowData[j], cx + 2, y + 2, { width: col.w - 4, align: col.align, lineBreak: false })
        cx += col.w
      }
      y += rowH
    }

    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(F).fontSize(7).text(fmt(subtotal), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += rowH

    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(FBI).fontSize(8).text('CGST', descLabelX, y + 2, { width: 60 })
    doc.font(F).fontSize(7).text(fmt(cgst), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += rowH

    checkPageBreak(rowH)
    drawHLine(doc, LM, R, y)
    doc.font(FBI).fontSize(8).text('SGST', descLabelX, y + 2, { width: 60 })
    doc.font(F).fontSize(7).text(fmt(sgst), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += rowH

    if (Math.abs(roundOff) >= 0.005) {
      checkPageBreak(rowH)
      drawHLine(doc, LM, R, y)
      doc.font(FBI).fontSize(8).text('ROUND OFF', descLabelX, y + 2, { width: 80 })
      doc.font(F).fontSize(7).text(fmtTotal(roundOff), amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
      y += rowH
    }

    checkPageBreak(22)
    const totalRowY = y
    drawHLine(doc, LM, R, y)
    y += 3
    doc.font(FB).fontSize(7).text('Total', LM + itemCols[0].w + 2, y + 3, { width: 50, align: 'right' })
    doc.font(FB).fontSize(9).text(`₹ ${fmtTotal(totalAmt)}`, amountColX + 2, y + 2, { width: amountColW - 4, align: 'right' })
    y += 18

    closeTableSegment()
    drawVLine(doc, amountColX, tableTop, y)

    const wordsY = y
    doc.font(F).fontSize(7).text('Amount Chargeable (in words)', LM + 3, y + 2)
    doc.font(F).fontSize(7).text('E. & O.E', R - 50, y + 2, { width: 48, align: 'right' })
    y += 11
    doc.font(FB).fontSize(8).text(`INR ${numberToWords(totalAmt)} Only`, LM + 3, y)
    y += 13
    drawRect(doc, LM, wordsY, pw, y - wordsY)

    if (y + 60 > pageBottom) { doc.addPage(); y = LM }
    const hsnY = y
    const hsnMap = new Map<string, { taxable: number; gstRate: number; cgst: number; sgst: number }>()
    for (const item of items) {
      const key = (item.hsn_code || 'N/A') + '__' + item.gst_rate
      const ex = hsnMap.get(key) || { taxable: 0, gstRate: item.gst_rate, cgst: 0, sgst: 0 }
      ex.taxable += item.amount
      ex.cgst += item.amount * item.gst_rate / 200
      ex.sgst += item.amount * item.gst_rate / 200
      hsnMap.set(key, ex)
    }

    const hsnFlatCols = [
      { label: 'HSN/SAC', w: 130, align: 'left' as const },
      { label: 'Taxable\nValue', w: 80, align: 'right' as const },
      { label: 'Rate', w: 40, align: 'center' as const },
      { label: 'Amount', w: 60, align: 'right' as const },
      { label: 'Rate', w: 40, align: 'center' as const },
      { label: 'Amount', w: 60, align: 'right' as const },
      { label: 'Total\nTax Amount', w: 70, align: 'right' as const },
    ]
    const hsnRaw = hsnFlatCols.reduce((s, c) => s + c.w, 0)
    const hsnSc = pw / hsnRaw
    hsnFlatCols.forEach(c => { c.w = Math.round(c.w * hsnSc) })
    hsnFlatCols[hsnFlatCols.length - 1].w += pw - hsnFlatCols.reduce((s, c) => s + c.w, 0)

    const hsnH1 = 12
    const hsnH2 = 12
    let cx = LM
    doc.font(FB).fontSize(6.5)
    drawRect(doc, cx, y, hsnFlatCols[0].w, hsnH1 + hsnH2)
    doc.text('HSN/SAC', cx + 2, y + hsnH1 / 2, { width: hsnFlatCols[0].w - 4, align: 'left' })
    cx += hsnFlatCols[0].w
    drawRect(doc, cx, y, hsnFlatCols[1].w, hsnH1 + hsnH2)
    doc.text('Taxable\nValue', cx + 2, y + 2, { width: hsnFlatCols[1].w - 4, align: 'right' })
    cx += hsnFlatCols[1].w
    const cgstW = hsnFlatCols[2].w + hsnFlatCols[3].w
    drawRect(doc, cx, y, cgstW, hsnH1)
    doc.text('CGST', cx + 2, y + 3, { width: cgstW - 4, align: 'center' })
    const sgstW = hsnFlatCols[4].w + hsnFlatCols[5].w
    drawRect(doc, cx + cgstW, y, sgstW, hsnH1)
    doc.text('SGST/UTGST', cx + cgstW + 2, y + 3, { width: sgstW - 4, align: 'center' })
    drawRect(doc, cx + cgstW + sgstW, y, hsnFlatCols[6].w, hsnH1 + hsnH2)
    doc.text('Total\nTax Amount', cx + cgstW + sgstW + 2, y + 2, { width: hsnFlatCols[6].w - 4, align: 'right' })
    y += hsnH1

    cx = LM + hsnFlatCols[0].w + hsnFlatCols[1].w
    for (let i = 2; i <= 5; i++) {
      drawRect(doc, cx, y, hsnFlatCols[i].w, hsnH2)
      doc.font(FB).fontSize(6.5).text(hsnFlatCols[i].label, cx + 2, y + 3, { width: hsnFlatCols[i].w - 4, align: hsnFlatCols[i].align })
      cx += hsnFlatCols[i].w
    }
    y += hsnH2

    let hsnTotalTaxable = 0, hsnTotalTax = 0
    doc.font(F).fontSize(7)
    for (const [key, vals] of hsnMap) {
      const hsn = key.split('__')[0]
      const halfRate = vals.gstRate / 2
      const totalTax = vals.cgst + vals.sgst
      hsnTotalTaxable += vals.taxable
      hsnTotalTax += totalTax
      cx = LM
      const rowData = [hsn, fmt(vals.taxable), `${halfRate}%`, fmt(vals.cgst), `${halfRate}%`, fmt(vals.sgst), fmt(totalTax)]
      for (let j = 0; j < hsnFlatCols.length; j++) {
        doc.text(rowData[j], cx + 2, y + 2, { width: hsnFlatCols[j].w - 4, align: hsnFlatCols[j].align })
        cx += hsnFlatCols[j].w
      }
      y += 12
    }

    drawHLine(doc, LM, R, y)
    y += 1
    cx = LM
    doc.font(FB).fontSize(7)
    doc.text('Total', cx + 2, y + 2, { width: hsnFlatCols[0].w - 4, align: 'right' })
    cx += hsnFlatCols[0].w
    doc.text(fmt(hsnTotalTaxable), cx + 2, y + 2, { width: hsnFlatCols[1].w - 4, align: 'right' })
    cx += hsnFlatCols[1].w + hsnFlatCols[2].w
    doc.text(fmt(cgst), cx + 2, y + 2, { width: hsnFlatCols[3].w - 4, align: 'right' })
    cx += hsnFlatCols[3].w + hsnFlatCols[4].w
    doc.text(fmt(sgst), cx + 2, y + 2, { width: hsnFlatCols[5].w - 4, align: 'right' })
    cx += hsnFlatCols[5].w
    doc.text(fmt(hsnTotalTax), cx + 2, y + 2, { width: hsnFlatCols[6].w - 4, align: 'right' })
    y += 14

    drawRect(doc, LM, hsnY, pw, y - hsnY)

    const taxWordsY = y
    const totalTaxAmt = cgst + sgst
    doc.font(F).fontSize(7).text('Tax Amount (in words) : ', LM + 3, y + 3, { continued: true })
    doc.font(FB).fontSize(7).text(`INR ${numberToWords(totalTaxAmt)} Only`)
    y += 14
    drawRect(doc, LM, taxWordsY, pw, y - taxWordsY)

    if (y + 110 > pageBottom) { doc.addPage(); y = LM }
    const bottomY = y
    const bottomH = 70
    const declW = pw * 0.48
    const bankW = pw - declW
    const bankX = LM + declW

    doc.font(FB).fontSize(7).text('Declaration', LM + 3, y + 3)
    y += 10
    doc.font(F).fontSize(6.5).text('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', LM + 3, y, { width: declW - 6 })

    let by = bottomY + 3
    doc.font(F).fontSize(7).text("Company's Bank Details", bankX + 2, by, { width: bankW - 4 })
    by += 10
    const bankLabelW = 90
    const bankValX = bankX + bankLabelW + 10
    const bankValW = bankW - bankLabelW - 14
    const bankDetails = [
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
    doc.font(FB).fontSize(7).text(`for ${business.tradeName.toUpperCase()}`, LM + declW + 2, sigY + 3, { width: bankW - 4, align: 'right' })
    doc.font(F).fontSize(7).text('Authorised Signatory', LM + declW + 2, sigY + sigH - 12, { width: bankW - 4, align: 'right' })

    y = sigY + sigH + 8
    doc.font(F).fontSize(7).text('SUBJECT TO RAIPUR JURISDICTION', LM, y, { width: pw, align: 'center' })
    y += 10
    doc.font(F).fontSize(6.5).text('This is a Computer Generated Invoice', LM, y, { width: pw, align: 'center' })

    doc.end()
  })
}
