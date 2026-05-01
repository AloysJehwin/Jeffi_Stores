const PDFDocument = eval('require')('pdfkit')
const QRCode = eval('require')('qrcode')
const bwipjs = eval('require')('bwip-js')

export interface LabelProduct {
  id: string
  product_id?: string
  variant_id?: string | null
  name: string
  variant_name?: string | null
  sku: string
  slug: string
  mrp: number | null
  sale_price: number | null
  base_price: number
  brand_name?: string | null
  gtin?: string | null
}

export type LabelSize = '30x20' | '30x50' | '40x60' | '50x50' | '80x20'

export interface LabelSpec {
  size: LabelSize
  widthPt: number
  heightPt: number
  label: string
  widthMm: number
  heightMm: number
}

const MM = 2.8346

export const LABEL_SIZES: LabelSpec[] = [
  { size: '30x20', widthMm: 30, heightMm: 20, widthPt: 30 * MM, heightPt: 20 * MM, label: '30×20 mm' },
  { size: '30x50', widthMm: 50, heightMm: 30, widthPt: 50 * MM, heightPt: 30 * MM, label: '30×50 mm' },
  { size: '40x60', widthMm: 60, heightMm: 40, widthPt: 60 * MM, heightPt: 40 * MM, label: '40×60 mm' },
  { size: '50x50', widthMm: 50, heightMm: 50, widthPt: 50 * MM, heightPt: 50 * MM, label: '50×50 mm' },
  { size: '80x20', widthMm: 80, heightMm: 20, widthPt: 80 * MM, heightPt: 20 * MM, label: '80×20 mm (Cable)' },
]

async function makeQRBuffer(text: string, size: number): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', width: size, margin: 1 })
}

async function makeBarcodeBuffer(text: string, heightMm: number): Promise<Buffer | null> {
  try {
    const safeText = text.replace(/[^\x20-\x7E]/g, '').slice(0, 48) || 'LABEL'
    return await bwipjs.toBuffer({
      bcid: 'code128',
      text: safeText,
      scale: 2,
      height: heightMm,
      includetext: true,
      textxalign: 'center',
      textsize: 5,
    })
  } catch {
    return null
  }
}

function fmt(price: number | null): string {
  if (price == null || price === 0) return ''
  return `Rs. ${Number(price).toFixed(2)}`
}

function displayName(p: LabelProduct): string {
  return p.variant_name ? `${p.name} — ${p.variant_name}` : p.name
}

function clip(text: string, maxPt: number, doc: any, font: string, size: number): string {
  doc.font(font).fontSize(size)
  while (text.length > 4 && doc.widthOfString(text) > maxPt) {
    text = text.slice(0, -2) + '…'
  }
  return text
}

async function render30x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 2.5
  const barcodeText = p.gtin || p.sku
  const barH = 7 * MM
  const topH = h - pad * 2 - barH - 1.5

  doc.font('Helvetica-Bold').fontSize(5)
  const line1 = clip(p.name, w - pad * 2, doc, 'Helvetica-Bold', 5)
  doc.text(line1, x + pad, y + pad, { width: w - pad * 2, lineBreak: false })

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(4.5).fillColor('#444444')
    const vline = clip(p.variant_name, w - pad * 2, doc, 'Helvetica', 4.5)
    doc.text(vline, x + pad, y + pad + 7, { width: w - pad * 2, lineBreak: false })
    doc.fillColor('#000000')
  }

  const barBuf = await makeBarcodeBuffer(barcodeText, 3)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barH, { width: w - pad * 2, height: barH })
  }
}

async function render30x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 10 * MM
  const barcodeText = p.gtin || p.sku

  doc.font('Helvetica-Bold').fontSize(7)
  const nameAreaH = h - pad * 2 - barcodeH - 10
  doc.text(p.name, x + pad, y + pad, { width: w - pad * 2, lineBreak: true, height: p.variant_name ? nameAreaH * 0.55 : nameAreaH * 0.75 })

  let cursor = y + pad
  doc.font('Helvetica-Bold').fontSize(7)
  const nameH = Math.min(doc.heightOfString(p.name, { width: w - pad * 2 }), nameAreaH * 0.75)
  cursor += nameH + 2

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(6).fillColor('#333333')
    doc.text(p.variant_name, x + pad, cursor, { width: w - pad * 2, lineBreak: false })
    cursor += 9
    doc.fillColor('#000000')
  }

  doc.font('Helvetica').fontSize(5.5).fillColor('#666666')
  doc.text(p.sku, x + pad, y + h - pad - barcodeH - 9, { width: w - pad * 2, lineBreak: false })
  doc.fillColor('#000000')

  const barBuf = await makeBarcodeBuffer(barcodeText, 4)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render40x60(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 9 * MM
  const qrSize = 12 * MM
  const barcodeText = p.gtin || p.sku

  const qrBuf = await makeQRBuffer(
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'}/products/${p.slug}`,
    Math.round(qrSize * 3)
  )
  const barBuf = await makeBarcodeBuffer(barcodeText, 3.5)

  const rightX = x + w - pad - qrSize
  const textW = rightX - x - pad - 2

  doc.font('Helvetica-Bold').fontSize(7.5)
  doc.text(p.name, x + pad, y + pad, { width: textW, lineBreak: true, height: p.variant_name ? 14 : 18 })

  let midY = y + pad + (p.variant_name ? 14 : 18) + 1

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(6).fillColor('#333333')
    doc.text(p.variant_name, x + pad, midY, { width: textW, lineBreak: false })
    midY += 9
    doc.fillColor('#000000')
  }

  doc.font('Helvetica').fontSize(5.5).fillColor('#555555')
  doc.text(`SKU: ${p.sku}`, x + pad, midY, { width: textW, lineBreak: false })
  midY += 8

  const price = p.sale_price ?? p.base_price
  if (p.mrp && p.mrp > 0 && p.mrp !== price) {
    doc.fontSize(5.5).fillColor('#888888')
    const mrpText = fmt(p.mrp)
    const mrpW = doc.widthOfString(mrpText)
    doc.text(mrpText, x + pad, midY, { lineBreak: false })
    doc.moveTo(x + pad, midY + 3.5).lineTo(x + pad + mrpW, midY + 3.5).stroke('#aaaaaa')
    midY += 8
    doc.fillColor('#c0392b').fontSize(8).font('Helvetica-Bold')
    doc.text(fmt(price), x + pad, midY, { lineBreak: false })
  } else if (price && price > 0) {
    doc.fillColor('#c0392b').fontSize(8).font('Helvetica-Bold')
    doc.text(fmt(price), x + pad, midY, { lineBreak: false })
  }

  if (qrBuf) {
    doc.image(qrBuf, rightX, y + pad, { width: qrSize, height: qrSize })
  }

  doc.fillColor('#000000')
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render50x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 10 * MM
  const qrSize = 14 * MM
  const barcodeText = p.gtin || p.sku

  const qrBuf = await makeQRBuffer(
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'}/products/${p.slug}`,
    Math.round(qrSize * 3)
  )
  const barBuf = await makeBarcodeBuffer(barcodeText, 4)

  const contentH = h - pad * 2 - barcodeH - 7
  const leftColW = qrSize + 3
  const rightX = x + pad + leftColW
  const rightW = w - pad * 2 - leftColW

  if (qrBuf) {
    doc.image(qrBuf, x + pad, y + pad, { width: qrSize, height: qrSize })
  }

  doc.font('Helvetica-Bold').fontSize(8)
  doc.text(p.name, rightX, y + pad, { width: rightW, lineBreak: true, height: p.variant_name ? 16 : 22 })

  let cur = y + pad + (p.variant_name ? 16 : 22) + 1

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(6.5).fillColor('#333333')
    doc.text(p.variant_name, rightX, cur, { width: rightW, lineBreak: false })
    cur += 9
    doc.fillColor('#000000')
  }

  if (p.brand_name) {
    doc.font('Helvetica').fontSize(6).fillColor('#777777')
    doc.text(p.brand_name, rightX, cur, { width: rightW, lineBreak: false })
    cur += 8
    doc.fillColor('#000000')
  }

  const price = p.sale_price ?? p.base_price
  if (p.mrp && p.mrp > 0 && p.mrp !== price) {
    doc.fontSize(5.5).fillColor('#888888')
    const mrpText = fmt(p.mrp)
    const mrpW = doc.widthOfString(mrpText)
    doc.text(mrpText, rightX, cur, { lineBreak: false })
    doc.moveTo(rightX, cur + 3.5).lineTo(rightX + mrpW, cur + 3.5).stroke('#aaaaaa')
    cur += 8
    doc.fillColor('#c0392b').fontSize(10).font('Helvetica-Bold')
    doc.text(fmt(price), rightX, cur, { lineBreak: false })
  } else if (price && price > 0) {
    doc.fillColor('#c0392b').fontSize(10).font('Helvetica-Bold')
    doc.text(fmt(price), rightX, cur, { lineBreak: false })
  }

  doc.fillColor('#000000').font('Helvetica').fontSize(5.5)
  doc.text(`SKU: ${p.sku}`, x + pad, y + h - pad - barcodeH - 8, { width: w - pad * 2, lineBreak: false })

  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render80x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 2.5
  const barH = 7 * MM
  const barcodeText = p.gtin || p.sku
  const contentW = 60 * MM
  const nameColW = contentW * 0.55
  const priceColW = contentW * 0.38
  const priceX = x + nameColW + 2

  doc.font('Helvetica-Bold').fontSize(6)
  const nameLine = clip(p.name, nameColW - pad * 2, doc, 'Helvetica-Bold', 6)
  doc.text(nameLine, x + pad, y + pad, { width: nameColW - pad * 2, lineBreak: false })

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(5).fillColor('#444444')
    const vline = clip(p.variant_name, nameColW - pad * 2, doc, 'Helvetica', 5)
    doc.text(vline, x + pad, y + pad + 8, { width: nameColW - pad * 2, lineBreak: false })
    doc.fillColor('#000000')
  }

  const price = p.sale_price ?? p.base_price
  if (price && price > 0) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#c0392b')
    doc.text(fmt(price), priceX, y + pad, { width: priceColW, lineBreak: false, align: 'right' })
    doc.fillColor('#000000')
  }

  const barBuf = await makeBarcodeBuffer(barcodeText, 3)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barH, { width: contentW - pad * 2, height: barH })
  }
}

type RenderFn = (doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) => Promise<void>

function getRenderFn(size: LabelSize): RenderFn {
  switch (size) {
    case '30x20': return render30x20
    case '30x50': return render30x50
    case '40x60': return render40x60
    case '50x50': return render50x50
    case '80x20': return render80x20
  }
}

export async function generateLabelPDF(
  products: LabelProduct[],
  size: LabelSize,
  copies: number
): Promise<Buffer> {
  const spec = LABEL_SIZES.find(s => s.size === size)!
  const renderFn = getRenderFn(size)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [spec.widthPt, spec.heightPt],
      margin: 0,
      autoFirstPage: false,
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    async function renderAll() {
      for (const product of products) {
        for (let i = 0; i < copies; i++) {
          doc.addPage()
          await renderFn(doc, product, 0, 0, spec.widthPt, spec.heightPt)
        }
      }
      doc.end()
    }
    renderAll().catch(reject)
  })
}

export async function generateLabelSheetPDF(
  products: LabelProduct[],
  size: LabelSize,
  copies: number
): Promise<Buffer> {
  const spec = LABEL_SIZES.find(s => s.size === size)!
  const renderFn = getRenderFn(size)

  const PAGE_W = 595.28
  const PAGE_H = 841.89
  const MARGIN = 18
  const GAP = 5

  const cols = Math.max(1, Math.floor((PAGE_W - MARGIN * 2 + GAP) / (spec.widthPt + GAP)))
  const rows = Math.max(1, Math.floor((PAGE_H - MARGIN * 2 + GAP) / (spec.heightPt + GAP)))

  const allLabels: LabelProduct[] = []
  for (const p of products) {
    for (let i = 0; i < copies; i++) allLabels.push(p)
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    async function renderAll() {
      let idx = 0
      while (idx < allLabels.length) {
        doc.addPage()
        for (let r = 0; r < rows && idx < allLabels.length; r++) {
          for (let c = 0; c < cols && idx < allLabels.length; c++) {
            const x = MARGIN + c * (spec.widthPt + GAP)
            const y = MARGIN + r * (spec.heightPt + GAP)
            doc.rect(x, y, spec.widthPt, spec.heightPt).dash(2, { space: 2 }).stroke('#bbbbbb').undash()
            await renderFn(doc, allLabels[idx], x, y, spec.widthPt, spec.heightPt)
            idx++
          }
        }
      }
      doc.end()
    }
    renderAll().catch(reject)
  })
}
