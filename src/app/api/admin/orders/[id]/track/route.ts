import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { resolveShipmentStatus, isAdvancement, shipmentStatusToSyncType } from '@/lib/shipment-status'

const TOKEN = process.env.DELHIVERY_API_KEY

const STATUS_SYNC: Record<string, {
  orderStatus: string
  setShippedAt?: boolean
  setDeliveredAt?: boolean
  clearAwb?: boolean
  onlyIfCurrent?: string[]
}> = {
  PU:        { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  IT:        { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  RAD:       { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT:        { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  OD:        { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DISPATCHED:{ orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DL:        { orderStatus: 'delivered',        setDeliveredAt: true, onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTO:       { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTRN:      { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-IT':  { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OT':  { orderStatus: 'out_for_delivery',                      onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OFD': { orderStatus: 'out_for_delivery',                      onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-DL':  { orderStatus: 'returned',         clearAwb: true,       onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing'] },
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<{
      awb_number: string | null; status: string; shipment_status: string | null
      order_number: string; customer_name: string; customer_email: string
    }>(
      `SELECT o.awb_number, o.status, o.shipment_status, o.order_number,
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
        },
        statusSynced: false,
        syncedTo: null,
        fromCache: true,
      })
    }

    if (!TOKEN) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

    const res = await fetch(
      `https://track.delhivery.com/api/v1/packages/json/?waybill=${order.awb_number}`,
      {
        headers: { Authorization: `Token ${TOKEN}` },
        next: { revalidate: 60 },
      }
    )

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
        setClauses.push(statusDateTime
          ? `shipped_at = LEAST(COALESCE(shipped_at, $2::timestamptz), $2::timestamptz)`
          : `shipped_at = COALESCE(shipped_at, NOW())`
        )
      }
      if (syncRule.setDeliveredAt) {
        setClauses.push(statusDateTime
          ? `delivered_at = $2::timestamptz`
          : `delivered_at = NOW()`
        )
      }
      if (syncRule.clearAwb) {
        setClauses.push(`awb_number = NULL`)
      }

      const queryParams: any[] = [id]
      if ((syncRule.setShippedAt || syncRule.setDeliveredAt) && statusDateTime) {
        queryParams.push(statusDateTime)
      }

      await query(
        `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1`,
        queryParams
      ).catch(() => {})

      if (order.customer_email && order.customer_name) {
        sendOrderStatusUpdate(
          order.customer_email, order.customer_name,
          order.order_number, id,
          syncRule.orderStatus, order.status
        ).catch(() => {})
      }

      statusSynced = true
    }

    // Always advance shipment_status if the new value is further along
    let effectiveShipmentStatus = newShipmentStatus
    if (isAdvancement(order.shipment_status as any, newShipmentStatus)) {
      await query(
        `UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`,
        [id, newShipmentStatus]
      ).catch(() => {})
    } else if (order.shipment_status) {
      // Delhivery returned a stale/lower status — keep the DB value so the UI doesn't regress
      effectiveShipmentStatus = order.shipment_status as any
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
      },
      statusSynced,
      syncedTo: statusSynced && statusType ? STATUS_SYNC[statusType]?.orderStatus : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
