import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { resolveShipmentStatus, isAdvancement, shipmentStatusToSyncType } from '@/lib/shipping/shipment-status'
import { fetchDelhiveryInvoiceCharges, chargeableGrams } from '@/lib/shipping/delhivery'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { settleDelhiveryCostToWallet } from '@/lib/payments/wallet'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'

const STATUS_SYNC: Record<
  string,
  {
    orderStatus: string
    setShippedAt?: boolean
    setDeliveredAt?: boolean
    clearAwb?: boolean
    onlyIfCurrent?: string[]
  }
> = {
  PU: { orderStatus: 'shipped', setShippedAt: true, onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  IT: { orderStatus: 'shipped', setShippedAt: true, onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  RAD: { orderStatus: 'shipped', setShippedAt: true, onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT: {
    orderStatus: 'out_for_delivery',
    setShippedAt: true,
    onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'],
  },
  OD: {
    orderStatus: 'out_for_delivery',
    setShippedAt: true,
    onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'],
  },
  DISPATCHED: {
    orderStatus: 'out_for_delivery',
    setShippedAt: true,
    onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'],
  },
  DL: {
    orderStatus: 'delivered',
    setDeliveredAt: true,
    onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'],
  },
  RTO: { orderStatus: 'shipped', onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTRN: { orderStatus: 'shipped', onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-IT': { orderStatus: 'shipped', onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OT': {
    orderStatus: 'out_for_delivery',
    onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'],
  },
  'RTO-OFD': {
    orderStatus: 'out_for_delivery',
    onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'],
  },
  'RTO-DL': { orderStatus: 'returned', clearAwb: true, onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing'] },
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<{
      awb_number: string | null
      status: string
      shipment_status: string | null
      order_number: string
      customer_name: string
      customer_email: string
      shipping_amount: number | null
      delhivery_quoted_weight_kg: number | null
      delhivery_charged_weight_kg: number | null
      delhivery_extra_charge: number | null
      delhivery_billed_amount: number | null
      delhivery_billed_at: string | null
      delhivery_freight_charge: number | null
      delhivery_cod_charge: number | null
      delhivery_oda_charge: number | null
      payment_mode: string | null
      dest_pin: string | null
    }>(
      `SELECT o.awb_number, o.status, o.shipment_status, o.order_number,
              o.shipping_amount, o.delhivery_quoted_weight_kg,
              o.delhivery_charged_weight_kg, o.delhivery_extra_charge,
              o.delhivery_billed_amount, o.delhivery_billed_at,
              o.delhivery_freight_charge, o.delhivery_cod_charge, o.delhivery_oda_charge,
              o.payment_mode,
              o.shipping_address_snapshot->>'postal_code' AS dest_pin,
              COALESCE(u.first_name || ' ' || u.last_name, o.customer_name) AS customer_name,
              COALESCE(u.email, o.customer_email) AS customer_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ tracking: null })

    // Default: return DB-cached shipment_status without hitting Delhivery.
    // Pass ?refresh=1 to force a live fetch and re-sync.
    const refresh = request.nextUrl.searchParams.get('refresh') === '1'
    if (!refresh) {
      return NextResponse.json({
        tracking: {
          awb: order.awb_number,
          status: null,
          statusType: null,
          shipmentStatus: order.shipment_status,
          statusDateTime: null,
          instructions: null,
          pickUpDate: null,
          expectedDelivery: null,
          origin: null,
          destination: null,
          scans: [],
          quotedWeightKg: order.delhivery_quoted_weight_kg ?? null,
          chargedWeightKg: order.delhivery_charged_weight_kg ?? null,
          shippingAmount: order.shipping_amount ?? null,
          extraCharge: order.delhivery_extra_charge ?? null,
          billedAmount: order.delhivery_billed_amount ?? null,
          billedAt: order.delhivery_billed_at ?? null,
          freightCharge: order.delhivery_freight_charge ?? null,
          codCharge: order.delhivery_cod_charge ?? null,
          odaCharge: order.delhivery_oda_charge ?? null,
        },
        statusSynced: false,
        syncedTo: null,
        fromCache: true,
      })
    }

    const TOKEN = await resolveDelhiveryToken()
    if (!TOKEN) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

    const res = await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${order.awb_number}`, {
      headers: { Authorization: `Token ${TOKEN}` },
      next: { revalidate: 60 },
    })

    if (!res.ok) return NextResponse.json({ error: 'Tracking unavailable' }, { status: 502 })

    const data = await res.json()
    const shipment = data?.ShipmentData?.[0]?.Shipment

    if (!shipment) return NextResponse.json({ tracking: null })

    const rawStatusType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
    const statusDateTime: string | null = shipment.Status?.StatusDateTime ?? null

    const rawScans: any[] = shipment.Scans ?? []
    const scans = rawScans.map((s: any) => ({
      date: s.ScanDetail?.ScanDateTime ?? null,
      location: s.ScanDetail?.ScannedLocation ?? null,
      activity: s.ScanDetail?.Scan ?? null,
      instructions: s.ScanDetail?.Instructions ?? null,
      scanType: s.ScanDetail?.ScanType ?? null,
    }))

    // Resolve stable internal shipment status from raw type + scan history
    const newShipmentStatus = resolveShipmentStatus(rawStatusType, scans, shipment.Status?.Status ?? null)

    // Derive the Delhivery statusType we use for STATUS_SYNC from the RESOLVED
    // status via the shared mapper — same logic as the cron sync route.
    const statusType = shipmentStatusToSyncType(newShipmentStatus)

    const syncRule = statusType ? STATUS_SYNC[statusType] : undefined
    let statusSynced = false

    if (syncRule && (!syncRule.onlyIfCurrent || syncRule.onlyIfCurrent.includes(order.status))) {
      const setClauses: string[] = [`status = '${syncRule.orderStatus}'`, `updated_at = NOW()`]

      if (syncRule.setShippedAt) {
        setClauses.push(
          statusDateTime
            ? `shipped_at = LEAST(COALESCE(shipped_at, $2::timestamptz), $2::timestamptz)`
            : `shipped_at = COALESCE(shipped_at, NOW())`
        )
      }
      if (syncRule.setDeliveredAt) {
        setClauses.push(statusDateTime ? `delivered_at = $2::timestamptz` : `delivered_at = NOW()`)
      }
      if (syncRule.clearAwb) {
        setClauses.push(`awb_number = NULL`)
      }

      const queryParams: any[] = [id]
      if ((syncRule.setShippedAt || syncRule.setDeliveredAt) && statusDateTime) {
        queryParams.push(statusDateTime)
      }

      await query(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1`, queryParams).catch(() => {})

      if (order.customer_email && order.customer_name) {
        sendOrderStatusUpdate(
          order.customer_email,
          order.customer_name,
          order.order_number,
          id,
          syncRule.orderStatus,
          order.status
        ).catch(() => {})
      }

      statusSynced = true
    }

    // Always advance shipment_status if the new value is further along
    let effectiveShipmentStatus = newShipmentStatus
    if (isAdvancement(order.shipment_status as any, newShipmentStatus)) {
      await query(`UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`, [
        id,
        newShipmentStatus,
      ]).catch(() => {})
    } else if (order.shipment_status) {
      effectiveShipmentStatus = order.shipment_status as any
    }

    // Persist charged weight from Delhivery and compute extra charge vs original quote.
    // ChargedWeight is the billing weight Delhivery used — may differ from quoted weight
    // if the actual parcel was heavier/larger (volumetric) than declared at shipment creation.
    const chargedWeightKg: number | null = shipment.ChargedWeight != null ? Number(shipment.ChargedWeight) : null
    let extraCharge: number | null = null
    if (chargedWeightKg != null && order.delhivery_quoted_weight_kg != null && order.shipping_amount != null) {
      const quotedKg = Number(order.delhivery_quoted_weight_kg)
      if (chargedWeightKg > quotedKg && quotedKg > 0) {
        // Estimate extra = (charged_kg / quoted_kg - 1) × shipping_amount
        extraCharge = Math.round((chargedWeightKg / quotedKg - 1) * Number(order.shipping_amount) * 100) / 100
      }
    }
    if (chargedWeightKg != null && chargedWeightKg !== Number(order.delhivery_charged_weight_kg)) {
      await query(
        `UPDATE orders SET delhivery_charged_weight_kg = $2, delhivery_extra_charge = $3, updated_at = NOW() WHERE id = $1`,
        [id, chargedWeightKg, extraCharge]
      ).catch(() => {})
    }

    // Pull actual invoice when status is delivered and not yet fetched
    let billedAmount = order.delhivery_billed_amount ?? null
    let billedAt = order.delhivery_billed_at ?? null
    let freightCharge = order.delhivery_freight_charge ?? null
    let codCharge = order.delhivery_cod_charge ?? null
    let odaCharge = order.delhivery_oda_charge ?? null
    if (newShipmentStatus === 'delivered' && !order.delhivery_billed_at) {
      const invoiceCharges = await fetchDelhiveryInvoiceCharges({
        awb: order.awb_number!,
        settledStatus: 'Delivered',
        chargedWeightG: chargeableGrams(order.delhivery_charged_weight_kg, order.delhivery_quoted_weight_kg),
        originPin: (await getBusinessValues()).delhiveryOriginPincode,
        destPin: order.dest_pin ?? '',
        paymentType: order.payment_mode === 'cod' ? 'COD' : 'Pre-paid',
      }).catch(() => null)
      if (invoiceCharges) {
        // Gate delhivery_billed_at on a durable wallet debit: settle first, and only stamp billed_at
        // when the charge is on the books (or no wallet applies). A transient debit failure leaves
        // billed_at NULL so the next 'delivered' sync retries instead of losing the charge.
        const tenantId = await resolveTenantId()
        const settled =
          tenantId && order.awb_number && invoiceCharges.total > 0
            ? await settleDelhiveryCostToWallet({
                tenantId,
                awb: order.awb_number,
                orderRef: order.order_number,
                amountInr: invoiceCharges.total,
              }).catch(() => false)
            : true
        await query(
          `UPDATE orders SET
            delhivery_billed_amount = $2, delhivery_freight_charge = $3,
            delhivery_cod_charge = $4, delhivery_oda_charge = $5,
            delhivery_billed_at = CASE WHEN $6 THEN NOW() ELSE delhivery_billed_at END,
            delhivery_extra_charge = ROUND(($2 - shipping_amount)::numeric, 2),
            updated_at = NOW()
           WHERE id = $1`,
          [id, invoiceCharges.total, invoiceCharges.freight, invoiceCharges.codCharge, invoiceCharges.oda, settled]
        ).catch(() => {})
        billedAmount = invoiceCharges.total
        billedAt = settled ? new Date().toISOString() : billedAt
        freightCharge = invoiceCharges.freight
        codCharge = invoiceCharges.codCharge
        odaCharge = invoiceCharges.oda
        if (order.shipping_amount != null) {
          extraCharge = Math.round((invoiceCharges.total - Number(order.shipping_amount)) * 100) / 100
        }
      }
    }

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        shipmentStatus: effectiveShipmentStatus,
        statusDateTime,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        scans,
        quotedWeightKg: order.delhivery_quoted_weight_kg ?? null,
        chargedWeightKg: chargedWeightKg ?? order.delhivery_charged_weight_kg ?? null,
        shippingAmount: order.shipping_amount ?? null,
        extraCharge: extraCharge ?? order.delhivery_extra_charge ?? null,
        billedAmount,
        billedAt,
        freightCharge,
        codCharge,
        odaCharge,
      },
      statusSynced,
      syncedTo: statusSynced && statusType ? STATUS_SYNC[statusType]?.orderStatus : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
