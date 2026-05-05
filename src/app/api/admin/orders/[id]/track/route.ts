import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'

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
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<{
      awb_number: string | null; status: string
      order_number: string; customer_name: string; customer_email: string
    }>(
      `SELECT o.awb_number, o.status, o.order_number,
              COALESCE(u.first_name || ' ' || u.last_name, o.customer_name) AS customer_name,
              COALESCE(u.email, o.customer_email) AS customer_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [params.id]
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

    const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])
    let statusType = rawStatusType
    if (EXCEPTION_TYPES.has(rawStatusType)) {
      const scans: any[] = shipment.Scans ?? []
      for (let i = scans.length - 1; i >= 0; i--) {
        const t = (scans[i]?.ScanDetail?.ScanType ?? '').toUpperCase()
        if (t && !EXCEPTION_TYPES.has(t)) { statusType = t; break }
        const activity = (scans[i]?.ScanDetail?.Scan ?? '').toLowerCase()
        if (activity.includes('out for delivery')) { statusType = 'OD'; break }
        if (activity.includes('rto delivered') || activity.includes('return delivered') || activity.includes('returned to origin')) { statusType = 'RTO-DL'; break }
        if (activity.includes('out for return')) { statusType = 'RTO-OT'; break }
        if (activity.includes('return in transit') || activity.includes('in return transit')) { statusType = 'RTO-IT'; break }
        if (activity.includes('rto initiated') || activity.includes('return initiated')) { statusType = 'RTO'; break }
        if (activity.includes('in transit') || activity === 'transit') { statusType = 'IT'; break }
        if (activity.includes('picked up') || activity.includes('shipment picked')) { statusType = 'PU'; break }
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

      const queryParams: any[] = [params.id]
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
          order.order_number, params.id,
          syncRule.orderStatus, order.status
        ).catch(() => {})
      }

      statusSynced = true
    }

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        statusDateTime,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        scans: (shipment.Scans ?? []).map((s: any) => ({
          date: s.ScanDetail?.ScanDateTime ?? null,
          location: s.ScanDetail?.ScannedLocation ?? null,
          activity: s.ScanDetail?.Scan ?? null,
          instructions: s.ScanDetail?.Instructions ?? null,
        })),
      },
      statusSynced,
      syncedTo: statusSynced ? STATUS_SYNC[statusType]?.orderStatus : null,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
