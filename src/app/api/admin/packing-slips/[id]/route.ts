import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { generatePackingSlipPDF, loadStoreSettings, PackingSlipOrder } from '@/lib/packing-slip-pdf'

async function fetchOrder(id: string): Promise<PackingSlipOrder | null> {
  const row = await queryOne(
    `SELECT o.id, o.order_number, o.created_at, o.customer_name, o.customer_phone,
            o.total_amount, o.discount_amount, o.business_discount_amount, o.shipping_amount,
            o.taxable_amount, o.cgst_amount, o.sgst_amount, o.igst_amount, o.is_igst,
            row_to_json(a) AS shipping_address,
            json_agg(json_build_object(
              'product_name', COALESCE(oi.product_name, p.name, 'Product'),
              'variant_name', oi.variant_name,
              'quantity', oi.quantity,
              'buy_mode', oi.buy_mode,
              'buy_unit', oi.buy_unit,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price,
              'mrp', oi.mrp,
              'discount_amount', oi.discount_amount,
              'hsn_code', COALESCE(oi.hsn_code, p.hsn_code),
              'gst_rate', COALESCE(oi.gst_rate, p.gst_percentage, 0),
              'taxable_amount', oi.taxable_amount,
              'cgst_amount', oi.cgst_amount,
              'sgst_amount', oi.sgst_amount,
              'igst_amount', oi.igst_amount,
              'image_url', pi.thumbnail_url
            ) ORDER BY oi.created_at) AS items
     FROM orders o
     LEFT JOIN addresses a ON a.id = o.shipping_address_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE o.id = $1
     GROUP BY o.id, a.id`,
    [id]
  )
  return row || null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [order, store] = await Promise.all([fetchOrder(id), loadStoreSettings()])
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Filter null items that json_agg produces when there are no matching rows
  order.items = (order.items || []).filter(Boolean)

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
    return NextResponse.json({ error: e.message || 'Failed to generate PDF', stack: e.stack }, { status: 500 })
  }
}
