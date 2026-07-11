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
  price_ex_gst: number | null
  base_price: number
  gst_percentage: number
  brand_name?: string | null
  gtin?: string | null
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  showPrice?: boolean
}

export type LabelSize = '30x20' | '30x50' | '40x60' | '50x50' | '80x20' | 'shelf-card'

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
  { size: 'shelf-card', widthMm: 100, heightMm: 70, widthPt: 100 * MM, heightPt: 70 * MM, label: '100×70 mm (Shelf Card)' },
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

function fmtShort(price: number | null): string {
  if (price == null || price === 0) return ''
  return `Rs. ${Number(price).toFixed(0)}`
}

function drawPrice(
  doc: any,
  p: LabelProduct,
  px: number,
  py: number,
  availW: number,
  mainSize: number,
  subSize: number
): number {
  const gstRate = Number(p.gst_percentage) || 0
  const rawEx = Number(p.price_ex_gst ?? p.base_price)
  if (!rawEx || rawEx === 0) return py

  const exGst = Math.round(rawEx * 100) / 100
  const incGst = gstRate > 0
    ? Math.round(exGst * (1 + gstRate / 100) * 100) / 100
    : exGst
  const showExGst = gstRate > 0

  if (p.mrp) {
    const mrpRaw = Number(p.mrp)
    if (mrpRaw > 0) {
      const mrpInc = gstRate > 0
        ? Math.round(mrpRaw * (1 + gstRate / 100) * 100) / 100
        : mrpRaw
      if (mrpInc !== incGst) {
        doc.font('Helvetica').fontSize(subSize).fillColor('#888888')
        const mrpText = `Rs. ${mrpInc.toFixed(2)}`
        const mrpW = doc.widthOfString(mrpText)
        doc.text(mrpText, px, py, { lineBreak: false })
        doc.moveTo(px, py + subSize * 0.38).lineTo(px + mrpW, py + subSize * 0.38).lineWidth(0.5).stroke('#888888')
        py += subSize + 1.5
      }
    }
  }

  doc.font('Helvetica-Bold').fontSize(mainSize).fillColor('#c0392b')
  doc.text(`Rs. ${incGst.toFixed(2)}`, px, py, { width: availW, lineBreak: false })
  py += mainSize + 1.5

  if (showExGst) {
    doc.font('Helvetica').fontSize(subSize - 0.5).fillColor('#777777')
    doc.text(`ex. GST Rs. ${exGst.toFixed(2)}`, px, py, { width: availW, lineBreak: false })
    py += subSize + 1
  }

  doc.fillColor('#000000')
  return py
}

function clip(text: string, maxPt: number, doc: any, font: string, size: number): string {
  doc.font(font).fontSize(size)
  while (text.length > 4 && doc.widthOfString(text) > maxPt) {
    text = text.slice(0, -2) + '…'
  }
  return text
}

function drawWarningIcons(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number, iconSize = 12) {
  const icons: { color: string; draw: (ix: number, iy: number, s: number) => void }[] = []

  if (p.flammable) {
    icons.push({ color: '#c0392b', draw: (ix, iy, s) => {
      // Flame: simplified triangle + teardrop
      doc.save().fillColor('#c0392b')
      doc.moveTo(ix + s * 0.5, iy)
        .lineTo(ix + s * 0.85, iy + s * 0.55)
        .lineTo(ix + s * 0.7, iy + s * 0.45)
        .lineTo(ix + s * 0.82, iy + s)
        .lineTo(ix + s * 0.18, iy + s)
        .lineTo(ix + s * 0.3, iy + s * 0.45)
        .lineTo(ix + s * 0.15, iy + s * 0.55)
        .closePath().fill()
      doc.restore()
    }})
  }

  if (p.hazardous) {
    icons.push({ color: '#e67e22', draw: (ix, iy, s) => {
      // Exclamation diamond
      doc.save().fillColor('#e67e22')
      doc.moveTo(ix + s * 0.5, iy)
        .lineTo(ix + s, iy + s * 0.5)
        .lineTo(ix + s * 0.5, iy + s)
        .lineTo(ix, iy + s * 0.5)
        .closePath().fill()
      doc.fillColor('#ffffff')
      doc.rect(ix + s * 0.44, iy + s * 0.28, s * 0.12, s * 0.32).fill()
      doc.circle(ix + s * 0.5, iy + s * 0.74, s * 0.07).fill()
      doc.restore()
    }})
  }

  if (p.fragile) {
    icons.push({ color: '#2980b9', draw: (ix, iy, s) => {
      // Broken glass / wine glass silhouette
      doc.save().fillColor('#2980b9')
      doc.moveTo(ix + s * 0.2, iy)
        .lineTo(ix + s * 0.8, iy)
        .lineTo(ix + s * 0.65, iy + s * 0.45)
        .lineTo(ix + s * 0.55, iy + s * 0.45)
        .lineTo(ix + s * 0.55, iy + s * 0.75)
        .lineTo(ix + s * 0.65, iy + s * 0.75)
        .lineTo(ix + s * 0.65, iy + s)
        .lineTo(ix + s * 0.35, iy + s)
        .lineTo(ix + s * 0.35, iy + s * 0.75)
        .lineTo(ix + s * 0.45, iy + s * 0.75)
        .lineTo(ix + s * 0.45, iy + s * 0.45)
        .lineTo(ix + s * 0.35, iy + s * 0.45)
        .closePath().fill()
      doc.restore()
    }})
  }

  if (icons.length === 0) return

  const gap = 1.5
  const totalW = icons.length * iconSize + (icons.length - 1) * gap
  let startX = x + w - totalW - 2
  const startY = y + h - 2 - iconSize * 2 - 2

  for (const icon of icons) {
    icon.draw(startX, startY, iconSize)
    startX += iconSize + gap
  }
}

async function render30x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 2.5
  const barcodeText = p.sku
  const barH = 7 * MM

  doc.font('Helvetica-Bold').fontSize(5)
  const line1 = clip(p.name, w - pad * 2, doc, 'Helvetica-Bold', 5)
  doc.text(line1, x + pad, y + pad, { width: w - pad * 2, lineBreak: false })

  let cur = y + pad + 6.5
  if (p.variant_name) {
    doc.font('Helvetica').fontSize(4.5).fillColor('#444444')
    const vline = clip(p.variant_name, w - pad * 2, doc, 'Helvetica', 4.5)
    doc.text(vline, x + pad, cur, { width: w - pad * 2, lineBreak: false })
    cur += 5.5
    doc.fillColor('#000000')
  }

  if (p.showPrice !== false) drawPrice(doc, p, x + pad, cur, w - pad * 2, 5, 4)

  const barBuf = await makeBarcodeBuffer(barcodeText, 3)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barH, { width: w - pad * 2, height: barH })
  }
  drawWarningIcons(doc, p, x, y, w, h, 5)
}

async function render30x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 10 * MM
  const barcodeText = p.sku

  doc.font('Helvetica-Bold').fontSize(7)
  const nameAreaH = h - pad * 2 - barcodeH - 10
  doc.text(p.name, x + pad, y + pad, { width: w - pad * 2, lineBreak: true, height: p.variant_name ? nameAreaH * 0.45 : nameAreaH * 0.55 })

  let cursor = y + pad
  doc.font('Helvetica-Bold').fontSize(7)
  const nameH = Math.min(doc.heightOfString(p.name, { width: w - pad * 2 }), nameAreaH * 0.55)
  cursor += nameH + 2

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(6).fillColor('#333333')
    doc.text(p.variant_name, x + pad, cursor, { width: w - pad * 2, lineBreak: false })
    cursor += 9
    doc.fillColor('#000000')
  }

  if (p.showPrice !== false) cursor = drawPrice(doc, p, x + pad, cursor, w - pad * 2, 7, 5.5)

  doc.font('Helvetica').fontSize(5.5).fillColor('#666666')
  doc.text(p.sku, x + pad, y + h - pad - barcodeH - 9, { width: w - pad * 2, lineBreak: false })
  doc.fillColor('#000000')

  const barBuf = await makeBarcodeBuffer(barcodeText, 4)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
  drawWarningIcons(doc, p, x, y, w, h, 6)
}

async function render40x60(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 9 * MM
  const qrSize = 12 * MM
  const barcodeText = p.sku

  const qrBuf = await makeQRBuffer(p.sku, Math.round(qrSize * 3))
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

  if (p.showPrice !== false) drawPrice(doc, p, x + pad, midY, textW, 8, 5.5)

  if (qrBuf) {
    doc.image(qrBuf, rightX, y + pad, { width: qrSize, height: qrSize })
  }

  doc.fillColor('#000000')
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
  drawWarningIcons(doc, p, x, y, w, h, 7)
}

async function render50x50(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 3.5
  const barcodeH = 10 * MM
  const qrSize = 14 * MM
  const barcodeText = p.sku

  const qrBuf = await makeQRBuffer(p.sku, Math.round(qrSize * 3))
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

  if (p.showPrice !== false) drawPrice(doc, p, rightX, cur, rightW, 10, 6)

  doc.fillColor('#000000').font('Helvetica').fontSize(5.5)
  doc.text(`SKU: ${p.sku}`, x + pad, y + h - pad - barcodeH - 8, { width: w - pad * 2, lineBreak: false })

  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barcodeH, { width: w - pad * 2, height: barcodeH })
  }
  drawWarningIcons(doc, p, x, y, w, h, 7)
}

async function render80x20(doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) {
  const pad = 2.5
  const barH = 7 * MM
  const barcodeText = p.sku
  const topH = h - pad - barH - pad

  const nameColW = w * 0.62
  const priceX = x + nameColW + 2
  const priceColW = w - nameColW - pad - 2

  doc.font('Helvetica-Bold').fontSize(7)
  const nameLine = clip(p.name, nameColW - pad * 2, doc, 'Helvetica-Bold', 7)
  doc.text(nameLine, x + pad, y + pad + 1, { width: nameColW - pad * 2, lineBreak: false })

  if (p.variant_name) {
    doc.font('Helvetica').fontSize(5.5).fillColor('#444444')
    const vline = clip(p.variant_name, nameColW - pad * 2, doc, 'Helvetica', 5.5)
    doc.text(vline, x + pad, y + pad + 9, { width: nameColW - pad * 2, lineBreak: false })
    doc.fillColor('#000000')
  }

  if (p.showPrice !== false) drawPrice(doc, p, priceX, y + pad, priceColW, 7, 4.5)

  const barBuf = await makeBarcodeBuffer(barcodeText, 3)
  if (barBuf) {
    doc.image(barBuf, x + pad, y + h - pad - barH, { width: w - pad * 2, height: barH })
  }
  drawWarningIcons(doc, p, x, y, w, h, 5)
}

type RenderFn = (doc: any, p: LabelProduct, x: number, y: number, w: number, h: number) => Promise<void>

function getRenderFn(size: LabelSize): RenderFn {
  switch (size) {
    case '30x20': return render30x20
    case '30x50': return render30x50
    case '40x60': return render40x60
    case '50x50': return render50x50
    case '80x20': return render80x20
    case 'shelf-card': return render30x20
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

export interface ShelfLabelItem {
  displayCode: string
  warehouseName: string
  productName?: string
  sku?: string
}

async function renderShelfCard(doc: any, item: ShelfLabelItem, x: number, y: number, w: number, h: number) {
  const pad = 5
  const barH = 12 * MM
  const qrSize = 22 * MM
  const textX = x + pad
  const textW = w - pad * 3 - qrSize

  const locationBarcode = item.displayCode.replace(/[^\x20-\x7E]/g, '').slice(0, 48) || 'SHELF'
  const barBuf = await makeBarcodeBuffer(locationBarcode, 4)
  if (barBuf) {
    doc.image(barBuf, textX, y + h - pad - barH, { width: w - pad * 2, height: barH })
  }
  doc.font('Helvetica').fontSize(6).fillColor('#555555')
  doc.text(item.displayCode, x + pad, y + h - pad - barH - 7, { width: w - pad * 2, align: 'center', lineBreak: false })

  const qrBuf = await makeQRBuffer(item.displayCode, Math.round(qrSize * 3))
  if (qrBuf) {
    doc.image(qrBuf, x + w - pad - qrSize, y + pad, { width: qrSize, height: qrSize })
  }

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a1a1a')
  doc.text(item.displayCode, textX, y + pad, { width: textW, lineBreak: false })

  doc.font('Helvetica').fontSize(8).fillColor('#777777')
  doc.text(item.warehouseName, textX, y + pad + 20, { width: textW, lineBreak: false })

  if (item.productName) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222222')
    const productY = y + pad + 34
    const maxProductH = h - pad * 2 - barH - 10 - 34
    doc.text(item.productName, textX, productY, { width: textW, lineBreak: true, height: maxProductH })
    if (item.sku) {
      doc.font('Helvetica').fontSize(7).fillColor('#555555')
      doc.text(`SKU: ${item.sku}`, textX, productY + 14, { width: textW, lineBreak: false })
    }
  }

  doc.fillColor('#000000')
}

export async function generateShelfLabelPDF(
  items: ShelfLabelItem[],
  copies: number
): Promise<Buffer> {
  const w = 100 * MM
  const h = 70 * MM

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [w, h], margin: 0, autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    async function renderAll() {
      for (const item of items) {
        for (let i = 0; i < copies; i++) {
          doc.addPage()
          await renderShelfCard(doc, item, 0, 0, w, h)
        }
      }
      doc.end()
    }
    renderAll().catch(reject)
  })
}
