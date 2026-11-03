import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query, queryMany } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { computeShipmentDims, fallbackShippingRate, ShipmentItem, PackageType } from '@/lib/shipping/shipping'
import { sendOrderShippedSMS } from '@/lib/shared/sms'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { listDelhiveryPickupLocations, cancelDelhiveryShipment, courierConsignee } from '@/lib/shipping/delhivery'
import { checkWalletForShipment, chargeDeliveryEstimate } from '@/lib/payments/wallet'
import { resolveShippingAccount } from '@/lib/shipping/delhivery-account'
import { applyCourierEdd } from '@/lib/shipping/courier-edd'
import { orderItemFactorSql } from '@/lib/orders/unit-conversion'

const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'

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
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const bv = await getBusinessValues()
    const ORIGIN_PIN = bv.delhiveryOriginPincode
    const PICKUP_LOCATION = bv.pickupLocation
    const SELLER_NAME = bv.sellerName
    const SELLER_ADD = bv.sellerAddress
    const SELLER_PHONE = bv.sellerPhone
    const { storeOrigin } = await import('@/lib/catalog/brand')
    const RETURN_ORIGIN = await storeOrigin()

    const order = await queryOne<any>(
      `
      SELECT
        o.*,
        sa.full_name, sa.address_line1, sa.address_line2, sa.landmark,
        sa.city, sa.state, sa.postal_code, sa.phone AS consignee_phone,
        u.email AS user_email,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital IS NOT TRUE)::int
          AS physical_item_count
      FROM orders o
      LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `,
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.awb_number)
      return NextResponse.json({ error: 'Shipment already created', awb: order.awb_number }, { status: 409 })
    if (order.physical_item_count === 0)
      return NextResponse.json({ error: 'This order has only digital items — nothing to ship.' }, { status: 422 })

    // Platform-account tenants pay from the prepaid wallet; own-account tenants and the flagship don't.
    const tenantId = (await resolveTenantId()) ?? undefined
    const account = await resolveShippingAccount(tenantId)
    if (!account.ok) return NextResponse.json({ error: account.error }, { status: 409 })

    const TOKEN = await resolveDelhiveryToken(tenantId)
    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    // Pickup warehouse: honour the posted choice only if it belongs to this account's
    // warehouses (cross-validated against the live list); otherwise fall back to the
    // tenant's stored default so a bad/foreign name can never reach Delhivery.
    let pickupLocationName = PICKUP_LOCATION
    const requested = String((await request.json().catch(() => ({})))?.pickupLocation || '').trim()
    if (requested) {
      const owned = await listDelhiveryPickupLocations(tenantId)
      if (owned.some(w => w.name === requested)) pickupLocationName = requested
    }

    const pin = order.postal_code
    if (!pin || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Order has invalid or missing delivery pincode' }, { status: 422 })
    }

    const consignee = courierConsignee({
      name: order.full_name || order.customer_name,
      phones: [order.consignee_phone, order.customer_phone],
      addressParts: [order.address_line1, order.address_line2, order.landmark],
      city: order.city,
      state: order.state,
    })
    if (!consignee.ok) return NextResponse.json({ error: consignee.error }, { status: 422 })
    const { name: consigneeName, phone: consigneePhone, address } = consignee

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

    const orderItemRows = await queryMany<any>(
      `
      SELECT
        COALESCE(oi.base_quantity, oi.quantity * COALESCE(${orderItemFactorSql()}, 1)) AS pieces,
        oi.variant_id,
        COALESCE(pv.variant_name, '') AS variant_name,
        COALESCE(oi.weight_grams, sv.weight_grams, pv.weight_grams, p.weight_grams, 500) AS weight_grams,
        COALESCE(oi.package_type, sv.package_type, pv.package_type, p.package_type) AS package_type,
        COALESCE(oi.length_cm, sv.length_cm, pv.length_cm, p.length_cm) AS length_cm,
        COALESCE(oi.breadth_cm, sv.breadth_cm, pv.breadth_cm, p.breadth_cm) AS breadth_cm,
        COALESCE(oi.height_cm, sv.height_cm, pv.height_cm, p.height_cm) AS height_cm
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN product_sub_variants sv ON sv.id = oi.sub_variant_id
      WHERE oi.order_id = $1 AND oi.is_digital IS NOT TRUE
    `,
      [id]
    )

    const shipmentItems: ShipmentItem[] = (orderItemRows || []).map((row: any) => ({
      packageType: (row.package_type as PackageType) || null,
      weightGrams: parseFloat(row.weight_grams) || 500,
      // Weight/dimensions are per piece; ship every piece of a set.
      quantity: Number(row.pieces) || 1,
      storedDims: {
        length_cm: row.length_cm ? parseFloat(row.length_cm) : null,
        breadth_cm: row.breadth_cm ? parseFloat(row.breadth_cm) : null,
        height_cm: row.height_cm ? parseFloat(row.height_cm) : null,
      },
      variantName: row.variant_name || undefined,
    }))

    const dims = computeShipmentDims(
      shipmentItems.length > 0
        ? shipmentItems
        : [
            {
              packageType: 'flat_poly_auto',
              weightGrams: 500,
              quantity: 1,
              storedDims: { length_cm: null, breadth_cm: null, height_cm: null },
            },
          ]
    )

    const weightKg = Math.max(0.1, Math.round(dims.chargedWeightGrams / 10) / 100)

    // Wallet hold = the quoted shipping, or a rate-card estimate when the customer shipped free.
    // Checked BEFORE the AWB is minted so an unpaid shipment is never created.
    let estimateInr = 0
    if (account.mode === 'platform') {
      estimateInr =
        Number(order.shipping_amount) > 0
          ? Number(order.shipping_amount)
          : fallbackShippingRate({
              chargedWeightGrams: dims.chargedWeightGrams,
              destinationPin: pin,
              originPin: String(ORIGIN_PIN || pin),
              cartonCount: 1,
            }).charge
      const check = await checkWalletForShipment({ tenantId, estimateInr })
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error, neededInr: check.neededInr, balanceInr: check.balanceInr, floorInr: check.floorInr },
          { status: 402 }
        )
      }
    }

    const shipmentPayload = {
      shipments: [
        {
          name: consigneeName,
          add: address,
          pin,
          city: consignee.city,
          state: consignee.state,
          country: 'India',
          phone: consigneePhone,
          order: invoiceRef,
          payment_mode: deliveryPaymentMode,
          return_pin: ORIGIN_PIN,
          return_city: RETURN_ORIGIN.city,
          return_phone: SELLER_PHONE,
          return_add: SELLER_ADD,
          return_state: RETURN_ORIGIN.state,
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
        },
      ],
      pickup_location: { name: pickupLocationName },
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
      return NextResponse.json(
        {
          error: 'Delhivery API error',
          details: data.rmk || 'Unknown error',
        },
        { status: 502 }
      )
    }

    const pkg = data.packages[0]

    if (pkg.status === 'Fail' || pkg.err_code) {
      const details = pkg.remarks?.join('; ') || 'Unknown error'
      console.error(`[create-shipment] Delhivery ${pkg.err_code} order=${id} ref=${invoiceRef}: ${details}`)
      return NextResponse.json(
        {
          error: 'Shipment creation failed',
          code: pkg.err_code,
          details:
            pkg.err_code === 'ER0005'
              ? `Delhivery flagged the consignee as suspicious. Check the customer's name, phone and address on this order (no placeholders, full street address), then retry — a retry uses a fresh reference. (${details})`
              : details,
        },
        { status: 422 }
      )
    }

    const awb = pkg.waybill
    if (!awb) {
      return NextResponse.json({ error: 'No AWB returned by Delhivery' }, { status: 502 })
    }

    // Courier TAT from Delhivery's expected-TAT API (read-only, non-fatal). Recorded as the courier
    // EDD; the tracking sync replaces it with Delhivery's own expected date once the parcel moves.
    let estimatedDeliveryDate: string | null = null
    try {
      const tatRes = await fetch(
        `https://track.delhivery.com/api/dc/expected_tat?origin_pin=${ORIGIN_PIN}&destination_pin=${pin}&mot=S&pdt=B2C`,
        { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } }
      )
      if (tatRes.ok) {
        const tatData = await tatRes.json()
        const tat = Number(tatData?.data?.tat ?? tatData?.tat ?? tatData?.[0]?.tat ?? NaN)
        if (Number.isFinite(tat) && tat > 0) {
          estimatedDeliveryDate = addBusinessDays(new Date(), tat).toISOString().slice(0, 10)
        }
      }
    } catch {
      // TAT lookup failed — keep the promised EDD
    }

    // Single deduction point for a forward shipment, keyed to the AWB (idempotent). If a concurrent
    // charge drained the wallet since the pre-check, cancel the AWB rather than ship unpaid.
    if (account.mode === 'platform' && tenantId) {
      const charge = await chargeDeliveryEstimate({
        tenantId,
        kind: 'forward',
        items: [{ awb, orderRef: order.order_number, estimateInr }],
      })
      if (!charge.ok) {
        const cancelled = await cancelDelhiveryShipment(awb, tenantId)
          .then(() => true)
          .catch(() => false)
        return NextResponse.json(
          {
            error: cancelled
              ? charge.error
              : `${charge.error} AWB ${awb} was created but could not be cancelled automatically — cancel it in Delhivery.`,
          },
          { status: 402 }
        )
      }
    }

    await query(
      `UPDATE orders SET awb_number = $1, status = 'processing',
        shipment_status = COALESCE(shipment_status, 'created'),
        delhivery_quoted_weight_kg = $3,
        updated_at = NOW()
       WHERE id = $2`,
      [awb, id, weightKg]
    )
    await applyCourierEdd(id, estimatedDeliveryDate, 'created').catch(() => {})

    const smsCustomer = await queryOne<{ phone: string | null; notification_channel: string | null }>(
      `SELECT u.phone, u.notification_channel FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [id]
    )
    if (smsCustomer?.notification_channel === 'sms' && smsCustomer.phone) {
      sendOrderShippedSMS({
        phone: smsCustomer.phone,
        orderNumber: order.order_number,
        trackingId: awb,
        courier: 'Delhivery',
      }).catch(() => {})
    }

    return NextResponse.json({
      awb,
      sortCode: pkg.sort_code,
      estimatedDeliveryDate,
      message: `Shipment created. AWB: ${awb}`,
      walletChargedInr: account.mode === 'platform' ? estimateInr : undefined,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
