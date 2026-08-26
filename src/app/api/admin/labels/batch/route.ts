import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getHost } from '@/lib/get-host'
import { ap } from '@/lib/admin-path'
import { queryMany } from '@/lib/db'
import { generateBatchLabelPDF, generateSerialLabelPDF, type LabelBatch, type LabelSerial } from '@/lib/label-pdf'

function buildQrUrl(host: string, productId: string, sku?: string | null): string {
  const params = new URLSearchParams({ scan_pid: productId })
  if (sku) params.set('scan_sku', sku)
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return `${proto}://${host}${ap(`/admin/dashboard?${params.toString()}`, host)}`
}

export const dynamic = 'force-dynamic'

// POST /api/admin/labels/batch  { batch_ids: string[], copies?, sheet? }
//   -> PDF, one label per batch (× copies)
// POST also handles serial mode when { serial_ids } or { serial_numbers } given.
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'labels:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const copies = Math.min(Math.max(parseInt(String(body?.copies ?? 1), 10) || 1, 1), 100)
    const sheet = body?.sheet === true
    const size = typeof body?.size === 'string' ? body.size : undefined
    const showPrice = body?.showPrice === true
    const qrAction = body?.qrAction === true
    const host = qrAction ? await getHost() : ''

    // ── Serial mode ──
    const serialIds: string[] = Array.isArray(body?.serial_ids) ? body.serial_ids.filter(Boolean) : []
    const serialNumbers: string[] = Array.isArray(body?.serial_numbers) ? body.serial_numbers.filter(Boolean) : []
    if (serialIds.length || serialNumbers.length) {
      const rows = await queryMany<any>(
        `SELECT ps.serial_number, ps.product_id, p.name AS product_name, p.sku, pv.variant_name,
                pb.lot_number, p.mrp, COALESCE(pv.price, p.base_price) AS base_price,
                p.price_ex_gst, COALESCE(p.gst_percentage, 0) AS gst_percentage
         FROM product_serials ps
         JOIN products p ON p.id = ps.product_id
         LEFT JOIN product_variants pv ON pv.id = ps.variant_id
         LEFT JOIN product_batches pb ON pb.id = ps.batch_id
         WHERE ${serialIds.length ? 'ps.id = ANY($1::uuid[])' : 'ps.serial_number = ANY($1::text[])'}
         ORDER BY ps.serial_number`,
        [serialIds.length ? serialIds : serialNumbers]
      )
      if (!rows.length) return NextResponse.json({ error: 'No serials found' }, { status: 404 })
      const serials: LabelSerial[] = rows.map(r => ({
        serialNumber: r.serial_number, productName: r.product_name, sku: r.sku,
        variantName: r.variant_name, lotNumber: r.lot_number,
        mrp: r.mrp, priceExGst: r.price_ex_gst ?? r.base_price, gstPercentage: r.gst_percentage,
        showPrice,
        qrUrl: qrAction && r.product_id ? buildQrUrl(host, r.product_id, r.sku) : undefined,
      }))
      const pdf = await generateSerialLabelPDF(serials, copies, sheet, size)
      return pdfResponse(pdf, `serial-labels-${serials.length}.pdf`)
    }

    // ── Batch mode ──
    // Two shapes:
    //   batch_ids: string[]                 → one label per batch (× copies)
    //   batches:   { id, count }[]           → `count` labels per batch (× copies),
    //                                          e.g. count defaults client-side to the
    //                                          batch's quantity_remaining.
    const batchCounts: Array<{ id: string; count: number }> = Array.isArray(body?.batches)
      ? body.batches
          .filter((b: any) => b && typeof b.id === 'string')
          .map((b: any) => ({ id: b.id, count: Math.min(Math.max(parseInt(String(b.count ?? 1), 10) || 1, 1), 9999) }))
      : []
    const legacyBatchIds: string[] = Array.isArray(body?.batch_ids) ? body.batch_ids.filter(Boolean) : []
    const batchIds: string[] = batchCounts.length ? batchCounts.map(b => b.id) : legacyBatchIds

    if (batchIds.length) {
      const rows = await queryMany<any>(
        `SELECT pb.id AS batch_id, pb.product_id, p.name AS product_name, p.sku, pv.variant_name,
                pb.lot_number, pb.manufacture_date, pb.expiry_date, pb.quantity_remaining,
                p.mrp, COALESCE(pv.price, p.base_price) AS base_price,
                p.price_ex_gst, COALESCE(p.gst_percentage, 0) AS gst_percentage
         FROM product_batches pb
         JOIN products p ON p.id = pb.product_id
         LEFT JOIN product_variants pv ON pv.id = pb.variant_id
         WHERE pb.id = ANY($1::uuid[])
         ORDER BY pb.lot_number`,
        [batchIds]
      )
      if (!rows.length) return NextResponse.json({ error: 'No batches found' }, { status: 404 })
      // Count per batch: from `batches[]` if given, else 1 each.
      const countById = new Map(batchCounts.map(b => [b.id, b.count]))
      const batches: LabelBatch[] = []
      for (const r of rows) {
        const one: LabelBatch = {
          batchId: r.batch_id, productName: r.product_name, sku: r.sku, variantName: r.variant_name,
          lotNumber: r.lot_number,
          manufactureDate: r.manufacture_date ? String(r.manufacture_date).slice(0, 10) : null,
          expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : null,
          quantity: r.quantity_remaining != null ? Number(r.quantity_remaining) : null,
          mrp: r.mrp, priceExGst: r.price_ex_gst ?? r.base_price, gstPercentage: r.gst_percentage,
          showPrice,
          qrUrl: qrAction && r.product_id ? buildQrUrl(host, r.product_id, r.sku) : undefined,
        }
        const n = countById.get(r.batch_id) ?? 1
        for (let i = 0; i < n; i++) batches.push(one)
      }
      const pdf = await generateBatchLabelPDF(batches, copies, sheet, size)
      return pdfResponse(pdf, `batch-labels-${batches.length}.pdf`)
    }

    return NextResponse.json({ error: 'Provide batch_ids, batches, serial_ids, or serial_numbers' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Label generation failed' }, { status: 500 })
  }
}

function pdfResponse(pdf: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
