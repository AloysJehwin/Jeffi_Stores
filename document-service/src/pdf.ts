import PDFDocument from 'pdfkit'
import type { RenderDocumentRequest, DocumentType } from '@jeffi/api-contracts'
import type { Totals } from './totals.js'

// One renderer, five layouts. Layout = colours/type/density; content is the same for every style so
// a tenant can switch `template` without changing their payload.
export interface Layout {
  accent: string
  ink: string
  muted: string
  rule: string
  band: string
  bandText: string
  font: 'Helvetica' | 'Times-Roman'
  size: [number, number] | 'A4'
  margin: number
  dense: boolean
}
export const LAYOUTS: Record<string, Layout> = {
  classic: { accent: '#1b1714', ink: '#1b1714', muted: '#6b6459', rule: '#d9d2c3', band: '#f3ead9', bandText: '#1b1714', font: 'Helvetica', size: 'A4', margin: 48, dense: false },
  minimal: { accent: '#111111', ink: '#111111', muted: '#888888', rule: '#eeeeee', band: '#ffffff', bandText: '#111111', font: 'Helvetica', size: 'A4', margin: 56, dense: false },
  bold: { accent: '#c46a46', ink: '#1b1714', muted: '#7a7064', rule: '#e3dacb', band: '#c46a46', bandText: '#ffffff', font: 'Helvetica', size: 'A4', margin: 44, dense: false },
  'gst-detailed': { accent: '#1e3a8a', ink: '#0f172a', muted: '#475569', rule: '#cbd5e1', band: '#e2e8f0', bandText: '#0f172a', font: 'Times-Roman', size: 'A4', margin: 40, dense: true },
  'thermal-80mm': { accent: '#000000', ink: '#000000', muted: '#333333', rule: '#000000', band: '#ffffff', bandText: '#000000', font: 'Helvetica', size: [226.77, 600], margin: 10, dense: true },
}

const TITLE: Record<DocumentType, string> = {
  invoice: 'TAX INVOICE',
  quotation: 'QUOTATION',
  receipt: 'RECEIPT',
  packing_slip: 'PACKING SLIP',
  label: 'SHIPPING LABEL',
  purchase_order: 'PURCHASE ORDER',
}
const inr = (n: number) => 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s?: string) => (s ? new Date(s) : new Date()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export function renderPdf(type: DocumentType, req: RenderDocumentRequest, totals: Totals, number: string, viewUrl: string): Promise<Buffer> {
  const L = LAYOUTS[req.template] ?? LAYOUTS.classic
  const thermal = L.size !== 'A4'
  const doc = new PDFDocument({ size: L.size, margin: L.margin, info: { Title: `${TITLE[type]} ${number}` } })
  const chunks: Buffer[] = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))))

  const W = doc.page.width - L.margin * 2
  const x0 = L.margin
  let y = L.margin
  const text = (s: string, x: number, yy: number, opts: PDFKit.Mixins.TextOptions & { size?: number; color?: string; bold?: boolean } = {}) => {
    doc.font(opts.bold ? (L.font === 'Times-Roman' ? 'Times-Bold' : 'Helvetica-Bold') : L.font).fontSize(opts.size ?? (L.dense ? 8 : 9)).fillColor(opts.color ?? L.ink)
    doc.text(s, x, yy, opts)
  }
  const party = (label: string, p: RenderDocumentRequest['seller'], x: number, yy: number, w: number) => {
    text(label, x, yy, { size: 7, color: L.muted })
    text(p.name, x, yy + 10, { bold: true, width: w })
    const lines = [p.address, [p.city, p.state, p.pincode].filter(Boolean).join(', '), p.gstin && `GSTIN ${p.gstin}`, p.phone, p.email].filter(Boolean) as string[]
    let ly = yy + 24
    for (const l of lines) {
      text(l, x, ly, { width: w, color: L.muted })
      ly += 11
    }
    return ly
  }

  // ── header band ──
  if (!thermal) {
    doc.rect(x0, y, W, 56).fill(L.band)
    text(TITLE[type], x0 + 16, y + 14, { size: 18, bold: true, color: L.bandText })
    text(number, x0 + 16, y + 36, { size: 10, color: L.bandText })
    text(`Date ${fmtDate(req.date)}${req.due_date ? `   ·   Due ${fmtDate(req.due_date)}` : ''}`, x0, y + 20, { width: W - 16, align: 'right', color: L.bandText })
    y += 72
    const half = (W - 24) / 2
    const a = party(type === 'purchase_order' ? 'FROM (BUYER)' : 'FROM', req.seller, x0, y, half)
    const b = party(type === 'purchase_order' ? 'TO (SUPPLIER)' : 'BILL TO', req.buyer, x0 + half + 24, y, half)
    let shipY = Math.max(a, b)
    if (req.ship_to) shipY = party('SHIP TO', req.ship_to, x0 + half + 24, shipY + 8, half)
    y = shipY + 16
  } else {
    text(req.seller.name, x0, y, { bold: true, size: 11, width: W, align: 'center' })
    y += 14
    if (req.seller.gstin) { text(`GSTIN ${req.seller.gstin}`, x0, y, { size: 7, width: W, align: 'center', color: L.muted }); y += 10 }
    text(`${TITLE[type]} · ${number}`, x0, y, { size: 8, width: W, align: 'center' })
    y += 10
    text(fmtDate(req.date), x0, y, { size: 7, width: W, align: 'center', color: L.muted })
    y += 14
    doc.moveTo(x0, y).lineTo(x0 + W, y).dash(2, { space: 2 }).stroke(L.rule).undash()
    y += 6
  }

  // ── items table ──
  const showTax = type === 'invoice' || type === 'quotation' || type === 'purchase_order' || type === 'receipt'
  const cols = thermal
    ? [{ k: 'description', w: 0.55, a: 'left' }, { k: 'quantity', w: 0.15, a: 'right' }, { k: 'total', w: 0.3, a: 'right' }]
    : showTax
      ? [{ k: 'description', w: 0.34, a: 'left' }, { k: 'hsn', w: 0.1, a: 'left' }, { k: 'quantity', w: 0.08, a: 'right' }, { k: 'unit_price', w: 0.12, a: 'right' }, { k: 'gst_rate', w: 0.08, a: 'right' }, { k: 'taxable', w: 0.13, a: 'right' }, { k: 'total', w: 0.15, a: 'right' }]
      : [{ k: 'description', w: 0.6, a: 'left' }, { k: 'hsn', w: 0.15, a: 'left' }, { k: 'quantity', w: 0.1, a: 'right' }, { k: 'unit', w: 0.15, a: 'left' }]
  const head: Record<string, string> = { description: 'Item', hsn: 'HSN/SAC', quantity: 'Qty', unit_price: 'Rate', gst_rate: 'GST', taxable: 'Taxable', total: 'Amount', unit: 'Unit' }
  const rowH = L.dense ? 14 : 18
  const drawHead = () => {
    if (!thermal) doc.rect(x0, y, W, rowH).fill(L.band)
    let cx = x0 + 4
    for (const c of cols) {
      text(head[c.k], cx, y + 4, { width: W * c.w - 8, align: c.a as any, size: 7, bold: true, color: thermal ? L.ink : L.bandText })
      cx += W * c.w
    }
    y += rowH
  }
  drawHead()
  for (const l of totals.lines) {
    if (y > doc.page.height - L.margin - 120 && !thermal) {
      doc.addPage()
      y = L.margin
      drawHead()
    }
    let cx = x0 + 4
    for (const c of cols) {
      const v = (l as any)[c.k]
      const s = c.k === 'quantity' ? String(v) : c.k === 'gst_rate' ? `${v}%` : typeof v === 'number' ? inr(v) : (v ?? '—')
      text(String(s), cx, y + 5, { width: W * c.w - 8, align: c.a as any })
      cx += W * c.w
    }
    y += rowH
    doc.moveTo(x0, y).lineTo(x0 + W, y).lineWidth(0.5).stroke(L.rule)
  }

  // ── totals ──
  if (showTax) {
    y += 10
    const tx = thermal ? x0 : x0 + W * 0.55
    const tw = thermal ? W : W * 0.45
    const row = (k: string, v: string, bold = false) => {
      text(k, tx, y, { width: tw * 0.55, color: bold ? L.ink : L.muted, bold })
      text(v, tx + tw * 0.55, y, { width: tw * 0.45, align: 'right', bold })
      y += 13
    }
    row('Subtotal', inr(totals.subtotal))
    if (totals.discount) row('Discount', '-' + inr(totals.discount))
    row('Taxable value', inr(totals.taxable))
    if (totals.is_igst) row('IGST', inr(totals.igst))
    else {
      row('CGST', inr(totals.cgst))
      row('SGST', inr(totals.sgst))
    }
    doc.moveTo(tx, y).lineTo(tx + tw, y).lineWidth(1).stroke(L.accent)
    y += 4
    row('Total', inr(totals.total), true)
  }

  // ── notes / terms / footer ──
  y += 10
  if (req.notes) { text('Notes', x0, y, { size: 7, color: L.muted }); text(req.notes, x0, y + 10, { width: W, color: L.ink }); y += 10 + doc.heightOfString(req.notes, { width: W }) + 8 }
  if (req.terms && !thermal) { text('Terms', x0, y, { size: 7, color: L.muted }); text(req.terms, x0, y + 10, { width: W, size: 7, color: L.muted }); y += 10 + doc.heightOfString(req.terms, { width: W }) + 8 }
  if (!thermal) {
    const fy = doc.page.height - L.margin - 12
    text(`View online: ${viewUrl}`, x0, fy, { size: 7, color: L.muted, width: W * 0.7 })
    text('Generated by Jeffi Commerce', x0, fy, { size: 7, color: L.muted, width: W, align: 'right' })
  }
  doc.end()
  return done
}
