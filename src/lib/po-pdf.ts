import 'server-only'
// eslint-disable-next-line no-eval
const PDFDocument = eval('require')('pdfkit')

export interface POItem {
  product_name: string
  variant_name?: string | null
  quantity: number
  unit_cost: number
}

export interface POBusinessSettings {
  legalName: string
  tradeName: string
  address: string
  phone: string
  email: string
  gstin: string
}

export async function generatePurchaseOrderPDF(
  po: {
    po_number: string
    order_date: string
    expected_date?: string | null
    notes?: string | null
    total_amount: string | number
    supplier_name: string
    contact_name?: string | null
    supplier_address?: string | null
    supplier_gstin?: string | null
    supplier_email?: string | null
  },
  items: POItem[],
  business: POBusinessSettings
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const blue = '#1a3a4a'
    const light = '#f3f4f6'

    doc.rect(0, 0, 595, 80).fill(blue)
    doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
      .text(business.tradeName || business.legalName, 50, 20)
    doc.fontSize(9).font('Helvetica')
      .text(business.address, 50, 46)
      .text(`GSTIN: ${business.gstin}  |  Phone: ${business.phone}`, 50, 58)

    doc.fillColor(blue).fontSize(22).font('Helvetica-Bold')
      .text('PURCHASE ORDER', 50, 100)

    doc.rect(50, 130, 240, 80).fill(light).stroke(light)
    doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold').text('PO Number', 60, 138)
    doc.font('Helvetica').text(po.po_number, 60, 150)
    doc.font('Helvetica-Bold').text('Order Date', 60, 166)
    doc.font('Helvetica').text(new Date(po.order_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), 60, 178)
    if (po.expected_date) {
      doc.font('Helvetica-Bold').text('Expected By', 160, 166)
      doc.font('Helvetica').text(new Date(po.expected_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), 160, 178)
    }

    doc.rect(305, 130, 240, 80).fill(light).stroke(light)
    doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold').text('Supplier', 315, 138)
    doc.font('Helvetica').text(po.supplier_name, 315, 150)
    if (po.contact_name) doc.text(`Attn: ${po.contact_name}`, 315, 162)
    if (po.supplier_address) doc.text(po.supplier_address, 315, 174, { width: 220, ellipsis: true })
    if (po.supplier_gstin) doc.text(`GSTIN: ${po.supplier_gstin}`, 315, 186)

    const tableTop = 230
    doc.rect(50, tableTop, 495, 20).fill(blue)
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
      .text('Product / Description', 60, tableTop + 6)
      .text('Qty', 360, tableTop + 6, { width: 50, align: 'right' })
      .text('Unit Cost', 420, tableTop + 6, { width: 70, align: 'right' })
      .text('Amount', 500, tableTop + 6, { width: 40, align: 'right' })

    let y = tableTop + 22
    let totalAmount = 0

    for (const item of items) {
      const lineTotal = item.quantity * item.unit_cost
      totalAmount += lineTotal
      const label = item.variant_name ? `${item.product_name} / ${item.variant_name}` : item.product_name
      const rowH = 22

      if (y > 720) {
        doc.addPage()
        y = 50
      }

      doc.fillColor('#374151').fontSize(9).font('Helvetica')
        .text(label, 60, y + 6, { width: 290 })
        .text(String(item.quantity), 360, y + 6, { width: 50, align: 'right' })
        .text(`₹${item.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 420, y + 6, { width: 70, align: 'right' })
        .text(`₹${lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 500, y + 6, { width: 40, align: 'right' })

      doc.moveTo(50, y + rowH).lineTo(545, y + rowH).stroke('#e5e7eb')
      y += rowH
    }

    y += 6
    doc.rect(400, y, 145, 24).fill(blue)
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text('Total', 410, y + 7)
      .text(`₹${Number(po.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 430, y + 7, { width: 105, align: 'right' })

    if (po.notes) {
      y += 40
      doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold').text('Notes:', 50, y)
      doc.font('Helvetica').text(po.notes, 50, y + 12, { width: 495 })
    }

    doc.fillColor('#9ca3af').fontSize(8).font('Helvetica')
      .text('This is a computer-generated purchase order.', 50, 780, { align: 'center', width: 495 })

    doc.end()
  })
}
