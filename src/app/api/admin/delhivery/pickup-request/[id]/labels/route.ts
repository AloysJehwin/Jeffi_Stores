import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { buildMergedLabelsPDF, type LabelInput, type LabelItem } from '@/lib/shipping-label-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Download all shipping labels for a pickup request as one merged 4×6 PDF —
 * one label page per AWB. Uses our own label layout built from order data (no
 * Delhivery round-trip), so it works regardless of the Delhivery label API.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const pickup = await queryOne<{ id: string; pickup_id: string | null; awbs: string[] }>(
      `SELECT id, pickup_id, awbs FROM delhivery_pickup_requests WHERE id = $1`,
      [id]
    )
    if (!pickup) return NextResponse.json({ error: 'Pickup request not found' }, { status: 404 })
    const awbs = (pickup.awbs || []).filter(Boolean)
    if (awbs.length === 0) return NextResponse.json({ error: 'No AWBs in this pickup request' }, { status: 404 })

    // Orders for these AWBs (with the shipping address for the label).
    const orders = await queryMany<any>(
      `SELECT o.id, o.order_number, o.awb_number, o.total_amount, o.payment_mode, o.payment_status,
              sa.full_name, sa.address_line1, sa.address_line2, sa.landmark, sa.city, sa.state, sa.postal_code
       FROM orders o
       LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
       WHERE o.awb_number = ANY($1::text[])`,
      [awbs]
    )
    const orderByAwb = new Map(orders.map(o => [o.awb_number, o]))

    // Line items for all these orders in one query, grouped per order.
    const orderIds = orders.map(o => o.id)
    const itemRows = orderIds.length
      ? await queryMany<any>(
          `SELECT order_id, product_name, variant_name, quantity, unit_price, total_price
           FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id`,
          [orderIds]
        )
      : []
    const itemsByOrder = new Map<string, LabelItem[]>()
    for (const r of itemRows) {
      const arr = itemsByOrder.get(r.order_id) || []
      arr.push({
        name: [r.product_name, r.variant_name].filter(Boolean).join(' — '),
        qty: Number(r.quantity) || 1,
        price: Number(r.unit_price) || 0,
        total: Number(r.total_price) || 0,
      })
      itemsByOrder.set(r.order_id, arr)
    }

    // Build one label per AWB (in the pickup request's AWB order). AWBs without a
    // matching order still get a minimal label so nothing is silently dropped.
    const labels: LabelInput[] = awbs.map(awb => {
      const order = orderByAwb.get(awb)
      const pkg = order?.payment_mode && String(order.payment_mode).toLowerCase().includes('cod') && order.payment_status !== 'paid'
        ? { cod: String(order.total_amount ?? '0') }
        : {}
      return {
        pkg,
        awb,
        orderRow: order || { awb_number: awb },
        items: order ? (itemsByOrder.get(order.id) || []) : [],
      }
    })

    const pdf = await buildMergedLabelsPDF(labels)
    const safeName = (pickup.pickup_id || pickup.id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')
    const filename = `pickup-labels-${safeName}.pdf`
    const inline = request.nextUrl.searchParams.get('inline') === '1'

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Content-Length': String(pdf.byteLength),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to generate labels' }, { status: 500 })
  }
}
