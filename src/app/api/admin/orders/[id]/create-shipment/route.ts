import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query, queryMany } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { computeShipmentDims, ShipmentItem, PackageType } from '@/lib/shipping'
import { sendOrderShippedSMS } from '@/lib/sms'
import { getBusinessValues } from '@/lib/site-controls'

const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'
const TOKEN = process.env.DELHIVERY_API_KEY

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0) added++ // skip Sundays
  }
  return d
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const bv = await getBusinessValues()
    const ORIGIN_PIN = bv.delhiveryOriginPincode
    const PICKUP_LOCATION = bv.pickupLocation
    const SELLER_NAME = bv.sellerName
    const SELLER_ADD = bv.sellerAddress
    const SELLER_PHONE = bv.sellerPhone

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
    `, [id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.awb_number) return NextResponse.json({ error: 'Shipment already created', awb: order.awb_number }, { status: 409 })

    const pin = order.postal_code
    if (!pin || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Order has invalid or missing delivery pincode' }, { status: 422 })
    }

    const consigneeName = order.full_name || order.customer_name || 'Customer'
    const rawPhone = (order.consignee_phone || order.customer_phone || '9999999999').replace(/\D/g, '')
    const consigneePhone = rawPhone.length === 12 && rawPhone.startsWith('91') ? rawPhone.slice(2) : rawPhone.slice(-10)
    const address = [order.address_line1, order.address_line2, order.landmark].filter(Boolean).join(', ')

    const productDesc = 'Hardware / Fasteners'
    const totalAmount = String(round2(Number(order.total_amount)))
    // COD orders must be shipped as COD with the collectable amount so Delhivery
    // collects cash on delivery; everything else ships Prepaid. Guard against a COD
    // order that was already paid (cod_collected) — then it's effectively prepaid.
    const isCodShipment = order.payment_mode === 'cod' && order.payment_status !== 'cod_collected'
    const codAmount = isCodShipment ? totalAmount : '0'
    const deliveryPaymentMode = isCodShipment ? 'COD' : 'Prepaid'
    const orderDate = new Date(order.created_at).toISOString().slice(0, 10)
    const baseRef = order.order_number || order.id.slice(0, 12)
    const invoiceRef = `${baseRef}-${Date.now()}`

    const orderItemRows = await queryMany<any>(`
      SELECT
        oi.quantity,
        oi.variant_id,
        COALESCE(pv.variant_name, '') AS variant_name,
        COALESCE(pv.weight_grams, p.weight_grams, 500) AS weight_grams,
        COALESCE(pv.package_type, p.package_type) AS package_type,
        COALESCE(pv.length_cm, p.length_cm) AS length_cm,
        COALESCE(pv.breadth_cm, p.breadth_cm) AS breadth_cm,
        COALESCE(pv.height_cm, p.height_cm) AS height_cm
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
    `, [id])

    const shipmentItems: ShipmentItem[] = (orderItemRows || []).map((row: any) => ({
      packageType: (row.package_type as PackageType) || null,
      weightGrams: parseFloat(row.weight_grams) || 500,
      quantity: parseInt(row.quantity) || 1,
      storedDims: {
        length_cm:  row.length_cm  ? parseFloat(row.length_cm)  : null,
        breadth_cm: row.breadth_cm ? parseFloat(row.breadth_cm) : null,
        height_cm:  row.height_cm  ? parseFloat(row.height_cm)  : null,
      },
      variantName: row.variant_name || undefined,
    }))

    const dims = computeShipmentDims(shipmentItems.length > 0 ? shipmentItems : [{
      packageType: 'flat_poly_auto',
      weightGrams: 500,
      quantity: 1,
      storedDims: { length_cm: null, breadth_cm: null, height_cm: null },
    }])

    const weightKg = Math.max(0.1, Math.round(dims.chargedWeightGrams / 10) / 100)

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
        payment_mode: deliveryPaymentMode,
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
        shipment_width: String(dims.breadth_cm),
        shipment_height: String(dims.height_cm),
        shipment_length: String(dims.length_cm),
        weight: String(weightKg),
      }],
      pickup_location: { name: PICKUP_LOCATION },
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

    // Fetch TAT (turnaround days) from Delhivery serviceability API — non-fatal
    let estimatedDeliveryDate: string | null = null
    try {
      const tatRes = await fetch(
        `https://track.delhivery.com/api/kinko/v0.2/pickup/serviceability/?md=S&ss=Delivered&d_pin=${pin}&o_pin=${ORIGIN_PIN}`,
        { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } }
      )
      if (tatRes.ok) {
        const tatData = await tatRes.json()
        const tat = tatData?.tat ?? tatData?.[0]?.tat ?? null
        if (typeof tat === 'number' && tat > 0) {
          estimatedDeliveryDate = addBusinessDays(new Date(), tat).toISOString().slice(0, 10)
        }
      }
    } catch {
      // TAT lookup failed — proceed without EDD
    }

    await query(
      // Only overwrite the EDD when the serviceability lookup returned a valid
      // date. Pre-pickup that lookup usually yields nothing, so COALESCE keeps the
      // EDD computed at order creation; the real Delhivery EDD lands later via the
      // status-sync route once the shipment is picked up.
      `UPDATE orders SET awb_number = $1, status = 'processing', estimated_delivery_date = COALESCE($3::date, estimated_delivery_date), shipment_status = COALESCE(shipment_status, 'created'), updated_at = NOW() WHERE id = $2`,
      [awb, id, estimatedDeliveryDate]
    )

    const smsCustomer = await queryOne<{ phone: string | null; notification_channel: string | null }>(
      `SELECT u.phone, u.notification_channel FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [id]
    )
    if (smsCustomer?.notification_channel === 'sms' && smsCustomer.phone) {
      sendOrderShippedSMS({ phone: smsCustomer.phone, orderNumber: order.order_number, trackingId: awb, courier: 'Delhivery' }).catch(() => {})
    }

    return NextResponse.json({
      awb,
      sortCode: pkg.sort_code,
      estimatedDeliveryDate,
      message: `Shipment created. AWB: ${awb}`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
