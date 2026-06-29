import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { resolveShipmentStatus, isAdvancement } from '@/lib/shipment-status'

const TOKEN = process.env.DELHIVERY_API_KEY

const STATUS_SYNC: Record<string, {
  orderStatus: string
  setShippedAt?: boolean
  setDeliveredAt?: boolean
  clearAwb?: boolean
  onlyIfCurrent?: string[]
}> = {
  PU:      { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  IT:      { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT:      { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  OD:      { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DL:      { orderStatus: 'delivered',        setDeliveredAt: true, onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTO:     { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-IT':{ orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OT':{ orderStatus: 'out_for_delivery',                      onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-DL':{ orderStatus: 'returned',         clearAwb: true,       onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing'] },
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
    const newShipmentStatus = resolveShipmentStatus(rawStatusType, scans)

    // Derive the Delhivery statusType string we use for STATUS_SYNC (keep legacy behaviour)
    const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])
    let statusType = rawStatusType
    if (EXCEPTION_TYPES.has(rawStatusType)) {
      for (let i = 0; i < rawScans.length; i++) {
        const t = (rawScans[i]?.ScanDetail?.ScanType ?? '').toUpperCase()
        if (t && !EXCEPTION_TYPES.has(t)) { statusType = t; break }
        const activity = (rawScans[i]?.ScanDetail?.Scan ?? '').toLowerCase()
        if (activity.includes('out for delivery')) { statusType = 'OD'; break }
        if (activity.includes('rto delivered') || activity.includes('return delivered') || activity.includes('returned to origin')) { statusType = 'RTO-DL'; break }
        if (activity.includes('out for return')) { statusType = 'RTO-OT'; break }
        if (activity.includes('return in transit') || activity.includes('in return transit')) { statusType = 'RTO-IT'; break }
        if (activity.includes('rto initiated') || activity.includes('return initiated')) { statusType = 'RTO'; break }
        if (activity.includes('in transit') || activity === 'transit') { statusType = 'IT'; break }
        if (activity.includes('picked up') || activity.includes('shipment picked') || activity.includes('pickup')) { statusType = 'PU'; break }
        if (activity === 'manifested' || activity.includes('manifest')) { statusType = 'MF'; break }
        if (activity.includes('delivered')) { statusType = 'DL'; break }
      }
    }

    const syncRule = STATUS_SYNC[statusType]
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
    if (isAdvancement(order.shipment_status as any, newShipmentStatus)) {
      await query(
        `UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`,
        [id, newShipmentStatus]
      ).catch(() => {})
    }

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        shipmentStatus: newShipmentStatus,
        statusDateTime,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        scans,
      },
      statusSynced,
      syncedTo: statusSynced ? STATUS_SYNC[statusType]?.orderStatus : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
