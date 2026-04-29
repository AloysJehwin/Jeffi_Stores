import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { generateBulkPackingSlipPDF, loadStoreSettings, PackingSlipOrder } from '@/lib/packing-slip-pdf'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { order_ids } = await request.json()
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return NextResponse.json({ error: 'order_ids required' }, { status: 400 })
  }
  if (order_ids.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 orders per bulk download' }, { status: 400 })
  }

  const [rows, store] = await Promise.all([
    queryMany(
      `SELECT o.id, o.order_number, o.created_at, o.customer_name, o.customer_phone,
              o.total_amount, o.discount_amount, o.shipping_amount,
              row_to_json(a) AS shipping_address,
              json_agg(json_build_object(
                'product_name', COALESCE(oi.product_name, p.name, 'Product'),
                'variant_name', oi.variant_name,
                'quantity', oi.quantity,
                'buy_mode', oi.buy_mode,
                'buy_unit', oi.buy_unit,
                'unit_price', oi.unit_price,
                'total_price', oi.total_price
              ) ORDER BY oi.created_at) AS items
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.shipping_address_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.id = ANY($1::uuid[])
       GROUP BY o.id, a.id
       ORDER BY o.created_at DESC`,
      [order_ids]
    ),
    loadStoreSettings(),
  ])

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No orders found' }, { status: 404 })
  }

  const orders: PackingSlipOrder[] = rows

  try {
    const pdfBuffer = await generateBulkPackingSlipPDF(orders, store)
    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="packing-slips-${date}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
