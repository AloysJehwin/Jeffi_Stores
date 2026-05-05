import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { generatePackingSlipPDF, loadStoreSettings, PackingSlipOrder } from '@/lib/packing-slip-pdf'

async function fetchOrder(id: string): Promise<PackingSlipOrder | null> {
  const row = await queryOne(
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
     WHERE o.id = $1
     GROUP BY o.id, a.id`,
    [id]
  )
  return row || null
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [order, store] = await Promise.all([fetchOrder(params.id), loadStoreSettings()])
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  try {
    const pdfBuffer = await generatePackingSlipPDF(order, store)
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline
          ? `inline; filename="packing-slip-${order.order_number}.pdf"`
          : `attachment; filename="packing-slip-${order.order_number}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
