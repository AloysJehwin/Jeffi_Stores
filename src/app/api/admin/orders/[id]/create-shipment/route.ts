import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'
const TOKEN = process.env.DELHIVERY_API_KEY
const ORIGIN_PIN = process.env.DELHIVERY_ORIGIN_PINCODE || '492001'
const PICKUP_LOCATION = process.env.DELHIVERY_PICKUP_LOCATION || 'Primary'
const SELLER_NAME = process.env.DELHIVERY_SELLER_NAME || 'Jeffi Stores'
const SELLER_ADD = process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur'
const SELLER_PHONE = process.env.DELHIVERY_SELLER_PHONE || '07713585374'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<any>(`
      SELECT
        o.*,
        sa.full_name, sa.address_line1, sa.address_line2, sa.landmark,
        sa.city, sa.state, sa.postal_code, sa.phone AS consignee_phone,
        u.email AS user_email
      FROM orders o
      LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.awb_number) return NextResponse.json({ error: 'Shipment already created', awb: order.awb_number }, { status: 409 })

    const pin = order.postal_code
    if (!pin || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Order has invalid or missing delivery pincode' }, { status: 422 })
    }

    const consigneeName = order.full_name || order.customer_name || 'Customer'
    const consigneePhone = order.consignee_phone || order.customer_phone || '9999999999'
    const address = [order.address_line1, order.address_line2, order.landmark].filter(Boolean).join(', ')

    const productDesc = 'Hardware / Fasteners'
    const codAmount = '0'
    const totalAmount = String(Math.round(Number(order.total_amount) * 100) / 100)
    const orderDate = new Date(order.created_at).toISOString().slice(0, 10)
    const invoiceRef = order.order_number || order.id.slice(0, 12)

    const orderItems = await queryOne<{ total_weight: number }>(`
      SELECT COALESCE(SUM(
        COALESCE(pv.weight_grams, p.weight_grams, 500) * oi.quantity::numeric
      ), 500) AS total_weight
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
    `, [params.id])

    const weightKg = Math.max(0.1, Math.round((orderItems?.total_weight || 500) / 100) / 10)

    const shipmentPayload = {
      shipments: [{
        name: consigneeName,
        add: address,
        pin,
        city: order.city || '',
        state: order.state || '',
        country: 'India',
        phone: consigneePhone,
        order: invoiceRef,
        payment_mode: 'Prepaid',
        return_pin: ORIGIN_PIN,
        return_city: 'Raipur',
        return_phone: SELLER_PHONE,
        return_add: SELLER_ADD,
        return_state: 'Chhattisgarh',
        return_country: 'India',
        products_desc: productDesc,
        hsn_code: '7318',
        cod_amount: codAmount,
        order_date: orderDate,
        total_amount: totalAmount,
        seller_add: SELLER_ADD,
        seller_name: SELLER_NAME,
        seller_inv: invoiceRef,
        quantity: '1',
        waybill: '',
        shipment_width: '15',
        shipment_height: '15',
        shipment_length: '20',
        weight: String(weightKg),
        pickup_location: PICKUP_LOCATION,
      }],
    }

    const formData = new URLSearchParams()
    formData.append('format', 'json')
    formData.append('data', JSON.stringify(shipmentPayload))

    const res = await fetch(DELHIVERY_CREATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      next: { revalidate: 0 },
    })

    const data = await res.json()

    if (!res.ok || !data.packages || data.packages.length === 0) {
      return NextResponse.json({
        error: 'Delhivery API error',
        details: data.rmk || 'Unknown error',
      }, { status: 502 })
    }

    const pkg = data.packages[0]

    if (pkg.status === 'Fail' || pkg.err_code) {
      return NextResponse.json({
        error: 'Shipment creation failed',
        code: pkg.err_code,
        details: pkg.remarks?.join('; ') || 'Unknown error',
      }, { status: 422 })
    }

    const awb = pkg.waybill
    if (!awb) {
      return NextResponse.json({ error: 'No AWB returned by Delhivery' }, { status: 502 })
    }

    await query(
      `UPDATE orders SET awb_number = $1, status = 'processing', updated_at = NOW() WHERE id = $2`,
      [awb, params.id]
    )

    return NextResponse.json({
      awb,
      sortCode: pkg.sort_code,
      message: `Shipment created. AWB: ${awb}`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
