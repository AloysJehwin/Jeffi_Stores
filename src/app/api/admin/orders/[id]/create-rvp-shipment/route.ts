import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { createRVPShipment } from '@/lib/delhivery'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.DELHIVERY_API_KEY) {
      return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })
    }

    const order = await queryOne<any>(`
      SELECT
        o.id, o.order_number, o.status, o.total_amount, o.created_at,
        sa.full_name, sa.address_line1, sa.address_line2, sa.landmark,
        sa.city, sa.state, sa.postal_code, sa.phone AS consignee_phone,
        u.email AS user_email
      FROM orders o
      LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (order.status !== 'return_approved') {
      return NextResponse.json({ error: `Cannot create RVP — order status is "${order.status}"` }, { status: 400 })
    }

    const pin = order.postal_code
    if (!pin || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Order has invalid or missing delivery pincode' }, { status: 422 })
    }

    const returnRequest = await queryOne<any>(
      `SELECT id, type, rvp_awb_number FROM return_requests
       WHERE order_id = $1 AND status NOT IN ('rejected', 'completed')
       ORDER BY created_at DESC LIMIT 1`,
      [params.id]
    )

    if (!returnRequest) {
      return NextResponse.json({ error: 'No active return request found for this order' }, { status: 404 })
    }

    if (returnRequest.rvp_awb_number) {
      return NextResponse.json({ error: 'RVP shipment already created', awb: returnRequest.rvp_awb_number }, { status: 409 })
    }

    const consigneeName = order.full_name || 'Customer'
    const consigneePhone = order.consignee_phone || '9999999999'
    const address = [order.address_line1, order.address_line2, order.landmark].filter(Boolean).join(', ')
    const invoiceRef = order.order_number || order.id.slice(0, 12)
    const totalAmount = String(Math.round(Number(order.total_amount) * 100) / 100)
    const orderDate = new Date(order.created_at).toISOString().slice(0, 10)

    const orderItems = await queryOne<{ total_weight: number; total_qty: number }>(`
      SELECT
        COALESCE(SUM(COALESCE(pv.weight_grams, p.weight_grams, 500) * oi.quantity::numeric), 500) AS total_weight,
        COALESCE(SUM(oi.quantity::numeric), 1) AS total_qty
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
    `, [params.id])

    const weightKg = Math.max(0.1, Math.round((orderItems?.total_weight || 500) / 10) / 100)
    const quantity = Math.max(1, Math.round(orderItems?.total_qty || 1))

    const awb = await createRVPShipment({
      consigneeName,
      address,
      pin,
      city: order.city || '',
      state: order.state || '',
      phone: consigneePhone,
      invoiceRef,
      totalAmount,
      orderDate,
      weightKg,
      productDesc: 'Hardware / Fasteners',
      quantity,
    })

    await query(
      `UPDATE return_requests SET rvp_awb_number = $1, rvp_created_at = NOW() WHERE id = $2`,
      [awb, returnRequest.id]
    )

    return NextResponse.json({ awb, message: `RVP shipment created. AWB: ${awb}` })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
