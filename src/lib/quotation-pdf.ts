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
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
    'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function grp(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + grp(n % 100) : '')
  }
  const crore = Math.floor(num / 10000000)
  const lakh  = Math.floor((num % 10000000) / 100000)
  const thou  = Math.floor((num % 100000) / 1000)
  const rem   = Math.floor(num % 1000)
  const paise = Math.round((num - Math.floor(num)) * 100)
  let r = ''
  if (crore) r += grp(crore) + ' Crore '
  if (lakh)  r += grp(lakh)  + ' Lakh '
  if (thou)  r += grp(thou)  + ' Thousand '
  if (rem)   r += grp(rem)
  r = r.trim()
  if (paise) r += ' and ' + grp(paise) + ' paise'
  return r
}

function fmt4(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-IN')
  return n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function formatDate(s: string): string {
  const d = new Date(s)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`
}

function getStateCode(state: string): string {
  const map: Record<string,string> = {
    'jammu and kashmir':'01','himachal pradesh':'02','punjab':'03','chandigarh':'04',
    'uttarakhand':'05','haryana':'06','delhi':'07','rajasthan':'08','uttar pradesh':'09',
    'bihar':'10','sikkim':'11','arunachal pradesh':'12','nagaland':'13','manipur':'14',
    'mizoram':'15','tripura':'16','meghalaya':'17','assam':'18','west bengal':'19',
    'jharkhand':'20','odisha':'21','chhattisgarh':'22','madhya pradesh':'23',
    'gujarat':'24','daman and diu':'25','dadra and nagar haveli':'26','maharashtra':'27',
    'andhra pradesh':'28','karnataka':'29','goa':'30','lakshadweep':'31','kerala':'32',
    'tamil nadu':'33','puducherry':'34','andaman and nicobar':'35','telangana':'36',
    'andhra pradesh (new)':'37','ladakh':'38',
  }
  return map[state.toLowerCase().trim()] || ''
}

function hline(doc: any, x1: number, x2: number, y: number) {
  doc.moveTo(x1, y).lineTo(x2, y).stroke()
}
function vline(doc: any, x: number, y1: number, y2: number) {
  doc.moveTo(x, y1).lineTo(x, y2).stroke()
}
function rect(doc: any, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h).stroke()
}

export function generateQuotationPDF(
  data: QuotationData,
  items: QuotationItem[],
  business: QuotationBusiness,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fontsDir = path.join(process.cwd(), 'public', 'fonts')
    const F   = path.join(fontsDir, 'NotoSans-Regular.ttf')
    const FB  = path.join(fontsDir, 'NotoSans-Bold.ttf')
    const FI  = path.join(fontsDir, 'NotoSans-Italic.ttf')
    const FBI = path.join(fontsDir, 'NotoSans-BoldItalic.ttf')

    const doc = new PDFDocument({ size: 'A4', margin: 28 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end',  () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const LM = 28, RM = 28
    const pageW = 595.28, pageH = 841.89
    const pw = pageW - LM - RM
    const R  = LM + pw
    const pageBottom = pageH - RM

    let y = LM

    doc.font(FB).fontSize(14).text('Quotation', LM, y, { width: pw, align: 'center' })
    y += 20

    const topY   = y
    const leftW  = Math.round(pw * 0.55)
    const metaX  = LM + leftW
    const metaW  = pw - leftW
    const metaRowH = 26
    const hw   = Math.round(metaW / 2)
    const hw2  = metaW - hw

    const logoPath = path.join(process.cwd(), 'public', 'images', 'logo.png')
    const logoSz   = 38
    try { doc.image(logoPath, LM + 3, topY + 4, { width: logoSz, height: logoSz }) } catch {}

    const bizX = LM + 3 + logoSz + 6
    const bizW = leftW - logoSz - 16
    let sy = topY + 4
    doc.font(FB).fontSize(10).text(business.tradeName.toUpperCase(), bizX, sy, { width: bizW })
    sy += 14
    const addrParts = business.address.split(',').map((s: string) => s.trim()).filter(Boolean)
    const addrLines: string[] = []
    let cur = ''
    for (const part of addrParts) {
      const candidate = cur ? cur + ', ' + part : part
      if (doc.font(F).fontSize(7.5).widthOfString(candidate) > bizW - 2 && cur) {
        addrLines.push(cur); cur = part
      } else { cur = candidate }
    }
    if (cur) addrLines.push(cur)
    for (const line of addrLines) {
      doc.font(F).fontSize(7.5).text(line, bizX, sy, { width: bizW }); sy += 10
    }
    doc.font(F).fontSize(7.5).text(`GSTIN/UIN: ${business.gstin}`, bizX, sy, { width: bizW }); sy += 10
    doc.font(F).fontSize(7.5).text(`State Name : ${business.state}, Code : ${business.stateCode}`, bizX, sy, { width: bizW }); sy += 10
    if (business.email) { doc.font(F).fontSize(7.5).text(`E-Mail : ${business.email}`, bizX, sy, { width: bizW }); sy += 10 }

    const sellerH = sy + 6 - topY
    rect(doc, LM, topY, leftW, sellerH)

    const c3w  = Math.round(metaW / 3)
    const c3bw = Math.round(metaW / 3)
    const c3cw = metaW - c3w - c3bw

    rect(doc, metaX,               topY, c3w,  metaRowH)
    rect(doc, metaX + c3w,         topY, c3bw, metaRowH)
    rect(doc, metaX + c3w + c3bw,  topY, c3cw, metaRowH)
    doc.font(F).fontSize(6.5)
    doc.text('Invoice No.',    metaX + 2,              topY + 2, { width: c3w - 4 })
    doc.text('e-Way Bill No.', metaX + c3w + 2,        topY + 2, { width: c3bw - 4 })
    doc.text('Dated',          metaX + c3w + c3bw + 2, topY + 2, { width: c3cw - 4 })
    doc.font(FB).fontSize(7.5).text(data.quote_number, metaX + 2, topY + 11, { width: c3w - 4 })
    doc.font(FB).fontSize(9).text(formatDate(data.quote_date), metaX + c3w + c3bw + 2, topY + 10, { width: c3cw - 4 })

    let my = topY + metaRowH
    if (my < topY + sellerH) {
      rect(doc, metaX, my, metaW, topY + sellerH - my)
      my = topY + sellerH
    }

    y = topY + sellerH

    function addrBlockLeft(
      label: string, name: string,
      a1: string, a2: string | null, city: string, state: string, gstin: string | null,
      startY: number,
    ): number {
      const tw = leftW - 6
      let ay = startY + 2

      doc.font(F).fontSize(7).text(label, LM + 3, ay, { width: tw, lineBreak: false })
      ay += doc.font(F).fontSize(7).heightOfString(label, { width: tw }) + 2

      doc.font(FB).fontSize(8.5).text(name, LM + 3, ay, { width: tw })
      ay += doc.font(FB).fontSize(8.5).heightOfString(name, { width: tw }) + 2

      if (a1) {
        doc.font(F).fontSize(7.5).text(a1, LM + 3, ay, { width: tw })
        ay += doc.font(F).fontSize(7.5).heightOfString(a1, { width: tw }) + 1
      }
      if (a2) {
        doc.font(F).fontSize(7.5).text(a2, LM + 3, ay, { width: tw })
        ay += doc.font(F).fontSize(7.5).heightOfString(a2, { width: tw }) + 1
      }
      if (city) {
        doc.font(F).fontSize(7.5).text(city, LM + 3, ay, { width: tw })
        ay += doc.font(F).fontSize(7.5).heightOfString(city, { width: tw }) + 1
      }
      if (gstin) {
        doc.font(F).fontSize(7.5).text('GSTIN/UIN', LM + 3, ay, { width: 44, lineBreak: false })
        doc.font(F).fontSize(7.5).text(`: ${gstin}`, LM + 50, ay, { width: tw - 50, lineBreak: false })
        ay += doc.font(F).fontSize(7.5).heightOfString('GSTIN/UIN', { width: tw }) + 1
      }
      const stCode = getStateCode(state)
      doc.font(F).fontSize(7.5).text('State Name', LM + 3, ay, { width: 44, lineBreak: false })
      doc.font(F).fontSize(7.5).text(`: ${state}${stCode ? ', Code : ' + stCode : ''}`, LM + 50, ay, { width: tw - 50, lineBreak: false })
      ay += doc.font(F).fontSize(7.5).heightOfString('State Name', { width: tw }) + 1

      return ay - startY + 4
    }

    const ca = {
      name: data.consignee_name, a1: data.consignee_addr1, a2: data.consignee_addr2,
      city: data.consignee_city, state: data.consignee_state, gstin: data.consignee_gstin,
    }
    const ba = data.buyer_same ? ca : {
      name: data.buyer_name, a1: data.buyer_addr1, a2: data.buyer_addr2,
      city: data.buyer_city, state: data.buyer_state, gstin: data.buyer_gstin,
    }

    const consigneeH = addrBlockLeft('Consignee (Ship to)', ca.name, ca.a1, ca.a2, ca.city, ca.state, ca.gstin, y)
    const buyerH     = addrBlockLeft('Buyer (Bill to)',     ba.name, ba.a1, ba.a2, ba.city, ba.state, ba.gstin, y + consigneeH)
    const addrTotalH = consigneeH + buyerH

    hline(doc, LM, metaX, y + consigneeH)
    rect(doc, LM, y, leftW, addrTotalH)

    const metaRows: [string, string][] = [
      ['Delivery Note',        'Mode/Terms of Payment'],
      ['Reference No. & Date.','Other References'],
      ["Buyer's Order No.",    'Dated'],
      ['Dispatch Doc No.',     'Delivery Note Date'],
      ['Dispatched through',   'Destination'],
      ['Terms of Delivery',    ''],
    ]
    for (const [l, r2] of metaRows) {
      if (my >= y + addrTotalH) break
      const rh = Math.min(metaRowH, y + addrTotalH - my)
      if (r2) {
        rect(doc, metaX,      my, hw,  rh)
        rect(doc, metaX + hw, my, hw2, rh)
        doc.font(F).fontSize(6.5).text(l,  metaX + 2,      my + 2, { width: hw - 4 })
        doc.font(F).fontSize(6.5).text(r2, metaX + hw + 2, my + 2, { width: hw2 - 4 })
      } else {
        rect(doc, metaX, my, metaW, rh)
        doc.font(F).fontSize(6.5).text(l, metaX + 2, my + 2, { width: metaW - 4 })
      }
      my += rh
    }
    if (my < y + addrTotalH) {
      rect(doc, metaX, my, metaW, y + addrTotalH - my)
    }

    vline(doc, metaX, topY, y + addrTotalH)
    rect(doc, LM, topY, pw, y + addrTotalH - topY)

    y = y + addrTotalH

    const colDefs = [
      { label: 'Sl\nNo.',             w: 20,  align: 'center' as const },
      { label: 'Description of Goods',w: 172, align: 'left'   as const },
      { label: 'HSN/SAC',             w: 44,  align: 'center' as const },
      { label: 'Quantity',            w: 52,  align: 'right'  as const },
      { label: 'Rate',                w: 58,  align: 'right'  as const },
      { label: 'per',                 w: 28,  align: 'center' as const },
      { label: 'Disc. %',             w: 36,  align: 'center' as const },
      { label: 'Amount',              w: 58,  align: 'right'  as const },
    ]
    const rawSum = colDefs.reduce((s, c) => s + c.w, 0)
    const sc2    = pw / rawSum
    const cols   = colDefs.map(c => ({ ...c, w: Math.round(c.w * sc2) }))
    cols[cols.length - 1].w += pw - cols.reduce((s, c) => s + c.w, 0)

    const amtW  = cols[7].w
    const amtX  = R - amtW
    const slW   = cols[0].w
    const hdrH  = 26
    const rowH  = 14

    const subtotal = items.reduce((s, i) => s + i.amount, 0)
    const cgst     = items.reduce((s, i) => s + i.amount * i.gst_rate / 200, 0)
    const sgst     = cgst
    const rawTotal = subtotal + cgst + sgst
    const total    = Math.round(rawTotal)
    const roundOff = total - rawTotal
    const hasRound = Math.abs(roundOff) >= 0.005

    const summaryH = rowH + rowH + rowH + rowH + (hasRound ? rowH : 0) + 20  // +1 blank row

    let tableTop = y

    function drawHeader() {
      let cx = LM
      for (const col of cols) {
        rect(doc, cx, y, col.w, hdrH)
        doc.font(FB).fontSize(7.5).text(
          col.label, cx + 2, y + (col.label.includes('\n') ? 4 : 9),
          { width: col.w - 4, align: col.align }
        )
        cx += col.w
      }
      y += hdrH
      tableTop = y
    }

    function closePageTable(endY: number) {
      rect(doc, LM, tableTop, pw, endY - tableTop)
      let cx = LM
      for (let i = 0; i < cols.length - 1; i++) {
        cx += cols[i].w
        vline(doc, cx, tableTop, endY)
      }
    }

    function pageBreak(need: number) {
      if (y + need > pageBottom) {
        closePageTable(y)
        doc.addPage()
        y = LM
        drawHeader()
      }
    }

    drawHeader()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const disc = item.discount_pct > 0 ? `${Number(item.discount_pct).toFixed(0)} %` : ''
      const descCol = cols[1]
      const descH = Math.max(rowH, doc.font(FB).fontSize(7).heightOfString(item.description, { width: descCol.w - 4 }) + 6)

      pageBreak(descH)

      let cx = LM
      const row = [
        String(i + 1),
        item.description,
        item.hsn_code || '',
        `${fmtQty(item.quantity)} ${item.unit}`,
        fmt4(item.rate),
        item.unit,
        disc,
        fmt4(item.amount),
      ]
      for (let j = 0; j < cols.length; j++) {
        const col = cols[j]
        const bold = j === 1 || j === 3 || j === 7
        doc.font(bold ? FB : F).fontSize(7)
        doc.text(row[j], cx + 2, y + 3, { width: col.w - 4, align: col.align, lineBreak: j === 1 })
        cx += col.w
      }
      y += descH
    }

    pageBreak(summaryH)
    y += rowH  // blank row between last item and subtotal
    hline(doc, LM, R, y)
    doc.font(FB).fontSize(7).text(fmt4(subtotal), amtX + 2, y + 3, { width: amtW - 4, align: 'right' })
    y += rowH

    const labelAreaW = amtX - (LM + slW) - 4
    hline(doc, LM, R, y)
    doc.font(FBI).fontSize(8).text('CGST', LM + slW + 2, y + 3, { width: labelAreaW, align: 'right' })
    doc.font(F).fontSize(7).text(fmt4(cgst), amtX + 2, y + 3, { width: amtW - 4, align: 'right' })
    y += rowH

    hline(doc, LM, R, y)
    doc.font(FBI).fontSize(8).text('SGST', LM + slW + 2, y + 3, { width: labelAreaW, align: 'right' })
    doc.font(F).fontSize(7).text(fmt4(sgst), amtX + 2, y + 3, { width: amtW - 4, align: 'right' })
    y += rowH

    if (hasRound) {
      hline(doc, LM, R, y)
      doc.font(FBI).fontSize(7).text('ROUND OFF', LM + slW + 2, y + 3, { width: labelAreaW, align: 'right', lineBreak: false })
      doc.font(F).fontSize(7).text(fmt4(roundOff), amtX + 2, y + 3, { width: amtW - 4, align: 'right' })
      y += rowH
    }

    hline(doc, LM, R, y)
    doc.font(FB).fontSize(8).text('Total', LM + slW + 2, y + 5, { width: labelAreaW, align: 'right', lineBreak: false })
    doc.font(FB).fontSize(8).text(`₹ ${fmt4(total)}`, amtX + 2, y + 5, { width: amtW - 4, align: 'right', lineBreak: false })
    y += 20

    closePageTable(y)

    const wordsText = `INR ${numberToWords(total)} Only`
    const wordsLineH = doc.font(FB).fontSize(8).heightOfString(wordsText, { width: pw - 10 })
    const wordsRowH = Math.max(24, 10 + wordsLineH + 6)
    const wordsY = y
    doc.font(F).fontSize(6.5).text('Amount Chargeable (in words)', LM + 3, y + 2, { width: pw * 0.7, lineBreak: false })
    doc.font(F).fontSize(6.5).text('E. & O.E', LM + 3, y + 2, { width: pw - 6, align: 'right', lineBreak: false })
    y += 10
    doc.font(FB).fontSize(8).text(wordsText, LM + 3, y, { width: pw - 10 })
    y = wordsY + wordsRowH
    rect(doc, LM, wordsY, pw, wordsRowH)

    if (y + 55 > pageBottom) { doc.addPage(); y = LM }
    const hsnY = y

    const hsnMap = new Map<string, { taxable: number; rate: number; cgstAmt: number; sgstAmt: number }>()
    for (const item of items) {
      const key = (item.hsn_code || 'N/A') + '__' + item.gst_rate
      const ex  = hsnMap.get(key) || { taxable: 0, rate: item.gst_rate, cgstAmt: 0, sgstAmt: 0 }
      ex.taxable  += item.amount
      ex.cgstAmt  += item.amount * item.gst_rate / 200
      ex.sgstAmt  += item.amount * item.gst_rate / 200
      hsnMap.set(key, ex)
    }

    const hDefs = [
      { w: 130, align: 'left'   as const },
      { w: 85,  align: 'right'  as const },
      { w: 35,  align: 'center' as const },
      { w: 65,  align: 'right'  as const },
      { w: 35,  align: 'center' as const },
      { w: 65,  align: 'right'  as const },
      { w: 65,  align: 'right'  as const },
    ]
    const hRaw = hDefs.reduce((s, c) => s + c.w, 0)
    const hSc  = pw / hRaw
    const hc   = hDefs.map(c => ({ ...c, w: Math.round(c.w * hSc) }))
    hc[hc.length - 1].w += pw - hc.reduce((s, c) => s + c.w, 0)

    const hh1 = 9, hh2 = 9
    let cx = LM
    doc.font(FB).fontSize(6.5)

    rect(doc, cx, y, hc[0].w, hh1 + hh2)
    doc.text('HSN/SAC', cx + 2, y + (hh1 + hh2) / 2 - 4, { width: hc[0].w - 4, align: 'left' })
    cx += hc[0].w

    rect(doc, cx, y, hc[1].w, hh1 + hh2)
    doc.text('Taxable\nValue', cx + 2, y + 2, { width: hc[1].w - 4, align: 'right' })
    cx += hc[1].w

    const cgstSpan = hc[2].w + hc[3].w
    rect(doc, cx, y, cgstSpan, hh1)
    doc.text('CGST', cx + 2, y + 3, { width: cgstSpan - 4, align: 'center' })

    const sgstSpan = hc[4].w + hc[5].w
    rect(doc, cx + cgstSpan, y, sgstSpan, hh1)
    doc.text('SGST/UTGST', cx + cgstSpan + 2, y + 3, { width: sgstSpan - 4, align: 'center' })

    rect(doc, cx + cgstSpan + sgstSpan, y, hc[6].w, hh1 + hh2)
    doc.text('Total\nTax Amount', cx + cgstSpan + sgstSpan + 2, y + 2, { width: hc[6].w - 4, align: 'right' })
    y += hh1

    cx = LM + hc[0].w + hc[1].w
    for (let i = 2; i <= 5; i++) {
      rect(doc, cx, y, hc[i].w, hh2)
      doc.font(FB).fontSize(6.5).text(hDefs[i].align === 'center' ? 'Rate' : 'Amount', cx + 2, y + 3, { width: hc[i].w - 4, align: hc[i].align })
      cx += hc[i].w
    }
    y += hh2

    let totTaxable = 0, totCgst = 0, totSgst = 0
    doc.font(F).fontSize(7)
    for (const [key, v] of hsnMap) {
      const hsn  = key.split('__')[0]
      const hr   = v.rate / 2
      const tot  = v.cgstAmt + v.sgstAmt
      totTaxable += v.taxable; totCgst += v.cgstAmt; totSgst += v.sgstAmt
      cx = LM
      const row = [hsn, fmt4(v.taxable), `${hr}%`, fmt4(v.cgstAmt), `${hr}%`, fmt4(v.sgstAmt), fmt4(tot)]
      for (let j = 0; j < hc.length; j++) {
        doc.text(row[j], cx + 2, y + 2, { width: hc[j].w - 4, align: hc[j].align })
        cx += hc[j].w
      }
      y += 13
    }

    hline(doc, LM, R, y); y += 1
    cx = LM
    doc.font(FB).fontSize(7)
    doc.text('Total', cx + 2, y + 2, { width: hc[0].w - 4, align: 'right' }); cx += hc[0].w
    doc.text(fmt4(totTaxable), cx + 2, y + 2, { width: hc[1].w - 4, align: 'right' }); cx += hc[1].w
    cx += hc[2].w
    doc.text(fmt4(totCgst), cx + 2, y + 2, { width: hc[3].w - 4, align: 'right' }); cx += hc[3].w
    cx += hc[4].w
    doc.text(fmt4(totSgst), cx + 2, y + 2, { width: hc[5].w - 4, align: 'right' }); cx += hc[5].w
    doc.text(fmt4(totCgst + totSgst), cx + 2, y + 2, { width: hc[6].w - 4, align: 'right' })
    y += 14
    rect(doc, LM, hsnY, pw, y - hsnY)

    const twY = y
    const taxWordsText = `INR ${numberToWords(cgst + sgst)} Only`
    const taxWordsH = Math.max(12, doc.font(FB).fontSize(7).heightOfString('Tax Amount (in words) : ' + taxWordsText, { width: pw - 6 }) + 4)
    doc.font(F).fontSize(7).text('Tax Amount (in words) : ', LM + 3, y + 2, { continued: true })
    doc.font(FB).fontSize(7).text(taxWordsText)
    y += taxWordsH
    rect(doc, LM, twY, pw, taxWordsH)

    const botH  = 52
    const sigH  = 22
    const footerH = botH + sigH + 6 + 9 + 9  // 98
    if (y + footerH > pageBottom) { doc.addPage(); y = LM }
    const botY  = y
    const declW = Math.round(pw * 0.50)
    const bankX = LM + declW
    const bankW = pw - declW

    doc.font(FB).fontSize(7).text('Declaration', LM + 3, y + 3)
    y += 10
    doc.font(F).fontSize(6.5).text(
      'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
      LM + 3, y, { width: declW - 6 }
    )

    let by = botY + 3
    doc.font(F).fontSize(7).text("Company's Bank Details", bankX + 3, by, { width: bankW - 6 }); by += 10
    const lblW = 82, valX = bankX + lblW + 4, valW = bankW - lblW - 10
    for (const bd of [
      { l: 'Bank Name',          v: business.bankName },
      { l: 'A/c No.',            v: business.bankAccount },
      { l: 'Branch & IFS Code',  v: `${business.bankBranch} & ${business.bankIfsc}` },
    ]) {
      doc.font(F).fontSize(6.5).text(`${bd.l}  :`, bankX + 3, by, { width: lblW })
      doc.font(FB).fontSize(6.5).text(bd.v, valX, by, { width: valW })
      by += 9
    }

    y = botY + botH
    rect(doc, LM,    botY, declW, botH)
    rect(doc, bankX, botY, bankW, botH)

    rect(doc, LM,    y, declW, sigH)
    rect(doc, bankX, y, bankW, sigH)
    doc.font(FB).fontSize(7).text(`for ${business.tradeName.toUpperCase()}`, bankX + 2, y + 3, { width: bankW - 4, align: 'right' })
    doc.font(F).fontSize(7).text('Authorised Signatory', bankX + 2, y + sigH - 10, { width: bankW - 4, align: 'right' })
    y += sigH + 6

    doc.font(F).fontSize(7).text('SUBJECT TO RAIPUR JURISDICTION', LM, y, { width: pw, align: 'center' }); y += 9
    doc.font(F).fontSize(6.5).text('This is a Computer Generated Invoice', LM, y, { width: pw, align: 'center' })

    doc.end()
  })
}
