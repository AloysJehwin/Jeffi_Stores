const PDFDocument = eval('require')('pdfkit')
const QRCode = eval('require')('qrcode')
const bwipjs = eval('require')('bwip-js')

export interface LabelProduct {
  id: string
  name: string
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
    return await bwipjs.toBuffer({
      bcid: 'code128',
      text,
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
  if (price == null) return ''
  return `Rs. ${Number(price).toFixed(2)}`
}

function clip(text: string, maxPt: number, doc: any, font: string, size: number): string {
  doc.font(font).fontSize(size)
  while (text.length > 3 && doc.widthOfString(text) > maxPt) {
    text = text.slice(0, -2) + '…'
  }
  return text
}

async function render30x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3
  const barcodeText = p.gtin || p.sku
  const barcodePt = 8 * MM
  const nameH = h - pad * 2 - barcodePt - 2

  doc.font('Helvetica-Bold').fontSize(5.5)
  const name = clip(p.name, w - pad * 2, doc, 'Helvetica-Bold', 5.5)
  doc.text(name, x + pad, y + pad, { width: w - pad * 2, lineBreak: false, ellipsis: true })

  const barBuf = await makeBarcodeBuffer(barcodeText, 3)
  if (barBuf) {
    const barW = w - pad * 2
    doc.image(barBuf, x + pad, y + pad + nameH, { width: barW, height: barcodePt })
  }
}

async function render30x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 4
  const barcodeH = 10 * MM
  const barBuf = await makeBarcodeBuffer(p.gtin || p.sku, 4)

  doc.font('Helvetica-Bold').fontSize(7)
  doc.text(p.name, x + pad, y + pad, { width: w - pad * 2, lineBreak: true, height: h - pad * 2 - barcodeH - 6 })

  doc.font('Helvetica').fontSize(6).fillColor('#555555')
  doc.text(p.sku, x + pad, y + h - pad - barcodeH - 8, { width: w - pad * 2, lineBreak: false })
  doc.fillColor('#000000')

  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render40x60(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 4
  const barcodeH = 10 * MM
  const qrSize = Math.round(13 * MM)
  const qrBuf = await makeQRBuffer(
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'}/products/${p.slug}`,
    qrSize * 2
  )
  const barBuf = await makeBarcodeBuffer(p.gtin || p.sku, 4)

  const nameH = 20
  doc.font('Helvetica-Bold').fontSize(8)
  doc.text(p.name, x + pad, y + pad, { width: w - pad * 2, height: nameH, lineBreak: true })

  const midY = y + pad + nameH + 3
  doc.font('Helvetica').fontSize(6).fillColor('#444444')
  doc.text(`SKU: ${p.sku}`, x + pad, midY, { width: w - qrSize - pad * 2 - 4, lineBreak: false })

  const price = p.sale_price ?? p.base_price
  if (p.mrp && p.mrp !== price) {
    doc.fontSize(6).fillColor('#888888')
    const mrpText = fmt(p.mrp)
    const mrpW = doc.widthOfString(mrpText)
    doc.text(mrpText, x + pad, midY + 9, { lineBreak: false })
    doc.moveTo(x + pad, midY + 12).lineTo(x + pad + mrpW, midY + 12).stroke('#888888')
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
    doc.text(fmt(price), x + pad, midY + 16, { lineBreak: false })
  } else if (price) {
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
    doc.text(fmt(price), x + pad, midY + 9, { lineBreak: false })
  }

  if (qrBuf) {
    doc.image(qrBuf, x + w - pad - qrSize, y + pad, { width: qrSize, height: qrSize })
  }

  if (barBuf) {
    doc.fillColor('#000000')
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render50x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 4
  const barcodeH = 10 * MM
  const qrSize = Math.round(15 * MM)
  const qrBuf = await makeQRBuffer(
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'}/products/${p.slug}`,
    qrSize * 2
  )
  const barBuf = await makeBarcodeBuffer(p.gtin || p.sku, 4)

  doc.font('Helvetica-Bold').fontSize(9)
  doc.text(p.name, x + qrSize + pad + 3, y + pad, { width: w - qrSize - pad * 2 - 3, height: 22, lineBreak: true })

  if (p.brand_name) {
    doc.font('Helvetica').fontSize(6.5).fillColor('#666666')
    doc.text(p.brand_name, x + qrSize + pad + 3, y + pad + 22, { width: w - qrSize - pad * 2 - 3, lineBreak: false })
  }

  const price = p.sale_price ?? p.base_price
  if (p.mrp && p.mrp !== price) {
    doc.fontSize(6).fillColor('#888888')
    const mrpText = fmt(p.mrp)
    const mrpW = doc.widthOfString(mrpText)
    doc.text(mrpText, x + qrSize + pad + 3, y + pad + 31, { lineBreak: false })
    doc.moveTo(x + qrSize + pad + 3, y + pad + 34).lineTo(x + qrSize + pad + 3 + mrpW, y + pad + 34).stroke('#888888')
    doc.fillColor('#e65100').fontSize(10).font('Helvetica-Bold')
    doc.text(fmt(price), x + qrSize + pad + 3, y + pad + 38, { lineBreak: false })
  } else if (price) {
    doc.fillColor('#e65100').fontSize(10).font('Helvetica-Bold')
    doc.text(fmt(price), x + qrSize + pad + 3, y + pad + 31, { lineBreak: false })
  }

  doc.fillColor('#000000').font('Helvetica').fontSize(6)
  doc.text(`SKU: ${p.sku}`, x + pad, y + h - pad - barcodeH - 10, { width: w - pad * 2, lineBreak: false })

  if (qrBuf) {
    doc.image(qrBuf, x + pad, y + pad, { width: qrSize, height: qrSize })
  }

  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
}

async function render80x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3
  const barH = 7 * MM
  const nameW = w * 0.55
  const priceW = w * 0.35

  doc.font('Helvetica-Bold').fontSize(6.5)
  doc.text(clip(p.name, nameW - pad * 2, doc, 'Helvetica-Bold', 6.5), x + pad, y + pad + 1, {
    width: nameW - pad * 2, lineBreak: false,
  })

  const price = p.sale_price ?? p.base_price
  if (price) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#e65100')
    doc.text(fmt(price), x + nameW, y + pad + 1, { width: priceW, lineBreak: false, align: 'right' })
  }

  const barBuf = await makeBarcodeBuffer(p.gtin || p.sku, 3)
  if (barBuf) {
    doc.fillColor('#000000')
    doc.image(barBuf, x + pad, y + h - pad - barH, { width: w * 0.6, height: barH })
  }

  doc.fillColor('#000000').font('Helvetica').fontSize(5)
  doc.text(p.sku, x + w * 0.62, y + h - pad - barH + 2, { width: w * 0.35, lineBreak: false })
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
  const GAP = 4

  const cols = Math.floor((PAGE_W - MARGIN * 2 + GAP) / (spec.widthPt + GAP))
  const rows = Math.floor((PAGE_H - MARGIN * 2 + GAP) / (spec.heightPt + GAP))
  const perPage = cols * rows

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
            doc.rect(x, y, spec.widthPt, spec.heightPt).dash(2, { space: 2 }).stroke('#cccccc').undash()
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
