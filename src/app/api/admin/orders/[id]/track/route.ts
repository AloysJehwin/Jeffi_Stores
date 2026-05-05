import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY

const STATUS_SYNC: Record<string, {
  orderStatus: string
  setShippedAt?: boolean
  setDeliveredAt?: boolean
  clearAwb?: boolean
  onlyIfCurrent?: string[]
}> = {
  PU:      { orderStatus: 'shipped',   setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  IT:      { orderStatus: 'shipped',   setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT:      { orderStatus: 'shipped',   setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DL:      { orderStatus: 'delivered', setDeliveredAt: true, onlyIfCurrent: ['shipped', 'processing', 'confirmed'] },
  'RTO-DL':{ orderStatus: 'returned',  clearAwb: true,       onlyIfCurrent: ['shipped', 'processing'] },
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<{ awb_number: string | null; status: string }>(
      `SELECT awb_number, status FROM orders WHERE id = $1`,
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

    const statusType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
    const statusDateTime: string | null = shipment.Status?.StatusDateTime ?? null

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
