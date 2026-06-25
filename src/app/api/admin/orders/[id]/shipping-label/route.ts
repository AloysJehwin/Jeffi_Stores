import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { round2 } from '@/lib/gst'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN = process.env.DELHIVERY_API_KEY

async function build4RPDF(pkg: any, awb: string, orderRow: any): Promise<Buffer> {
  const PDFDocument = eval('require')('pdfkit')
  const bwipjs = eval('require')('bwip-js')
  const path = eval('require')('path')

  async function barcode(text: string, heightMm: number): Promise<Buffer | null> {
    try {
      const safe = text.replace(/[^\x20-\x7E]/g, '').slice(0, 48) || 'X'
      return await bwipjs.toBuffer({ bcid: 'code128', text: safe, scale: 2, height: heightMm, includetext: false })
    } catch { return null }
  }

  const sortCode: string = pkg.sort_code || pkg.st || ''
  const destPin: string = pkg.pin || orderRow.postal_code || ''
  const consigneeName: string = pkg.name || orderRow.full_name || ''
  const pkgAdd: string = pkg.add || ''
  const addrFromDB: string = [orderRow.address_line1, orderRow.address_line2, orderRow.landmark, orderRow.city, orderRow.state].filter(Boolean).join(', ')
  const consigneeAdd: string = pkgAdd || addrFromDB
  const sellerName: string = pkg.sname || 'Jeffi Stores'
  const sellerAdd: string = pkg.sadd || process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur'
  const invoiceNo: string = pkg.oid || pkg.order || orderRow.order_number || ''
  const productDesc: string = pkg.prd || 'Hardware / Fasteners'
  const codAmount: number = parseFloat(pkg.cod || '0')
  const totalAmount: string = pkg.total_amount || pkg.amount || (codAmount > 0 ? codAmount.toFixed(2) : String(round2(Number(orderRow.total_amount))))
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
    + ' | ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

  const addrLines = consigneeAdd
    .split(/[\n,]/)
    .map((s: string) => s.trim())
    .filter(Boolean)

  const [awbBarBuf, invBarBuf] = await Promise.all([
    barcode(awb, 14),
    barcode(invoiceNo, 10),
  ])

  return new Promise((resolve, reject) => {
    const M = 4
    const W = 4 * 72
    const H = 6 * 72
    const p = 8
    const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const BW = W - M * 2
    const BH = H - M * 2
    doc.rect(M, M, BW, BH).lineWidth(1).strokeColor('#000').stroke()

    const hline = (yy: number, lw = 0.5) =>
      doc.moveTo(M, yy).lineTo(M + BW, yy).lineWidth(lw).strokeColor('#000').stroke()
    const vline = (xx: number, y1: number, y2: number) =>
      doc.moveTo(xx, y1).lineTo(xx, y2).lineWidth(0.5).strokeColor('#000').stroke()

    let y = M

    doc.fontSize(9).font('Helvetica').fillColor('#000').text(sellerName, M + p + 24, y + 8, { lineBreak: false })
    try {
      const storeLogo = path.join(process.cwd(), 'public', 'images', 'store-logo.png')
      doc.image(storeLogo, M + p, y + 4, { width: 20, height: 20 })
    } catch { }
    try {
      const logoPath = path.join(process.cwd(), 'public', 'delhivery-logo.png')
      const logoH = 18
      const logoW = Math.round(logoH * (3246 / 546))
      doc.image(logoPath, M + BW - logoW - p, y + 6, { width: logoW, height: logoH })
    } catch (err) {
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#e63927').text('DELHIVERY', 0, y + 4, { width: M + BW - p, align: 'right', lineBreak: false })
    }
    y += 30; hline(y)

    doc.fontSize(7).font('Helvetica').fillColor('#000').text(`AWB# ${awb}`, M + p, y + 5, { lineBreak: false })
    if (awbBarBuf) {
      doc.image(awbBarBuf, M + p, y + 15, { width: BW - p * 2, height: 46 })
    }
    const pinY = y + 67
    doc.fontSize(8).font('Helvetica').fillColor('#000').text(destPin, M + p, pinY, { lineBreak: false })
    doc.fontSize(8).font('Helvetica-Bold').text(`AWB# ${awb}`, 0, pinY, { width: W, align: 'center', lineBreak: false })
    doc.fontSize(8).font('Helvetica-Bold').text(sortCode, 0, pinY, { width: M + BW - p, align: 'right', lineBreak: false })
    y += 90; hline(y)

    const col2X = M + Math.round(BW * 0.54)
    const row3Y = y
    const addrLineCount = Math.max(addrLines.length, 3)
    const row3H = Math.max(100, 28 + addrLineCount * 12 + 20)
    vline(col2X, row3Y, row3Y + row3H)

    const addrW = col2X - M - p * 2
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(`Ship to - ${consigneeName}`, M + p, y + 6, { width: addrW, lineBreak: false })
    let addrY = y + 22
    for (const line of addrLines) {
      const isPinLine = /^\d{6}$/.test(line)
      doc.fontSize(isPinLine ? 9 : 8)
        .font(isPinLine ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor('#000')
        .text(line, M + p, addrY, { width: addrW, lineBreak: false })
      addrY += 12
    }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
      .text(`PIN - ${destPin}`, M + p, row3Y + row3H - 16, { width: addrW, lineBreak: false })

    const rX = col2X + p
    const rW = M + BW - col2X - p * 2
    const payLabel = codAmount > 0 ? 'COD - Surface' : 'Pre-paid - Surface'
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(payLabel, rX, y + 6, { width: rW })
    if (totalAmount) {
      doc.fontSize(11).font('Helvetica-Bold').text(`INR ${totalAmount}`, rX, y + 19, { width: rW })
    }
    doc.moveTo(col2X, y + 37).lineTo(M + BW, y + 37).lineWidth(0.3).strokeColor('#aaa').stroke()
    doc.fontSize(7).font('Helvetica').fillColor('#000').text(`Inv# ${invoiceNo}`, rX, y + 41, { width: rW })
    doc.moveTo(col2X, y + 56).lineTo(M + BW, y + 56).lineWidth(0.3).strokeColor('#aaa').stroke()
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text('Date', rX, y + 60, { width: rW })
    doc.fontSize(7).font('Helvetica').fillColor('#000').text(dateStr, rX, y + 72, { width: rW })
    y += row3H; hline(y)

    const row4H = 72
    vline(col2X, y, y + row4H)
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000').text(`Seller: ${sellerName}`, M + p, y + 6, { width: col2X - M - p * 2 })
    doc.fontSize(7).font('Helvetica').fillColor('#000').text(sellerAdd, M + p, y + 17, { width: col2X - M - p * 2 })

    const shortInv = invoiceNo.length > 22 ? invoiceNo.slice(0, 22) + '...' : invoiceNo
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(shortInv, col2X + p, y + 5, { width: rW })
    if (invBarBuf) {
      doc.image(invBarBuf, col2X + p, y + 24, { width: rW - 2, height: 36 })
    }
    y += row4H; hline(y)

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000').text('Product Name', M + p, y + 6, { width: BW * 0.48, lineBreak: false })
    doc.text('Qty.', M + BW * 0.5, y + 6, { width: 28, align: 'right', lineBreak: false })
    doc.text('Price', M + BW * 0.66, y + 6, { width: 40, align: 'right', lineBreak: false })
    doc.text('Total', M + BW * 0.83, y + 6, { width: BW * 0.17 - p, align: 'right', lineBreak: false })
    y += 18; hline(y)

    doc.fontSize(7).font('Helvetica').fillColor('#000').text(productDesc, M + p, y + 5, { width: BW * 0.48, lineBreak: false })
    doc.text('1', M + BW * 0.5, y + 5, { width: 28, align: 'right', lineBreak: false })
    doc.text(totalAmount || '', M + BW * 0.66, y + 5, { width: 40, align: 'right', lineBreak: false })
    doc.text(totalAmount || '', M + BW * 0.83, y + 5, { width: BW * 0.17 - p, align: 'right', lineBreak: false })

    const footerY = M + BH - 20
    hline(footerY)
    doc.fontSize(6.5).font('Helvetica').fillColor('#000')
      .text(`Return Address: ${sellerAdd}`, M + p, footerY + 5, { width: BW * 0.78 - p })
    doc.text('Page 1 of 1', M + BW * 0.78, footerY + 5, { width: BW * 0.22 - p, align: 'right', lineBreak: false })

    doc.end()
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<any>(
      `SELECT o.order_number, o.awb_number, o.total_amount,
              sa.full_name, sa.address_line1, sa.address_line2, sa.landmark,
              sa.city, sa.state, sa.postal_code
       FROM orders o
       LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
       WHERE o.id = $1`,
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const pdfSize = (request.nextUrl.searchParams.get('size') === '4R') ? '4R' : 'A4'
    const print = request.nextUrl.searchParams.get('print') === '1'
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const safeOrderNum = (order.order_number || id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')

    if (pdfSize === '4R') {
      const labelUrl = `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(order.awb_number)}`
      const res = await fetch(labelUrl, { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } })
      if (!res.ok) return NextResponse.json({ error: `Delhivery label API returned ${res.status}` }, { status: 502 })

      const data = await res.json()
      const pkg = data?.packages?.[0] ?? {}

      const buffer = await build4RPDF(pkg, order.awb_number, order)

      if (print) {
        const pdfBase64 = buffer.toString('base64')
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}@page{size:4in 6in;margin:0;}iframe{display:block;width:100%;height:100%;border:none;}</style></head><body><iframe id="f" src="data:application/pdf;base64,${pdfBase64}" onload="try{var f=document.getElementById('f');f.contentWindow.focus();f.contentWindow.print();}catch(e){}"></iframe></body></html>`
        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }

      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': inline
            ? `inline; filename="shipping-label-${safeOrderNum}.pdf"`
            : `attachment; filename="shipping-label-${safeOrderNum}.pdf"`,
          'Content-Length': String(buffer.byteLength),
        },
      })
    }

    const labelUrl = `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(order.awb_number)}&pdf=true`
    const res = await fetch(labelUrl, { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } })
    if (!res.ok) return NextResponse.json({ error: `Delhivery label API returned ${res.status}` }, { status: 502 })

    const contentType = res.headers.get('content-type') || ''
    let buffer: ArrayBuffer

    if (contentType.includes('application/pdf')) {
      buffer = await res.arrayBuffer()
    } else {
      const json = await res.json()
      const pdfUrl: string | undefined = json?.packages?.[0]?.pdf_download_link
      if (!pdfUrl) return NextResponse.json({ error: 'No PDF link in Delhivery response' }, { status: 502 })
      const pdfRes = await fetch(pdfUrl)
      if (!pdfRes.ok) return NextResponse.json({ error: `Failed to fetch PDF from S3: ${pdfRes.status}` }, { status: 502 })
      buffer = await pdfRes.arrayBuffer()
    }

    if (print) {
      const pdfBase64 = Buffer.from(buffer).toString('base64')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}@page{size:A4;margin:0;}iframe{display:block;width:100%;height:100%;border:none;}</style></head><body><iframe id="f" src="data:application/pdf;base64,${pdfBase64}" onload="try{var f=document.getElementById('f');f.contentWindow.focus();f.contentWindow.print();}catch(e){}"></iframe></body></html>`
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline
          ? `inline; filename="shipping-label-${safeOrderNum}.pdf"`
          : `attachment; filename="shipping-label-${safeOrderNum}.pdf"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
