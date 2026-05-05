import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DELHIVERY_TOKEN = process.env.DELHIVERY_API_KEY
const CRON_SECRET = process.env.CRON_SECRET

const STATUS_SYNC: Record<string, {
  orderStatus: string
  setShippedAt?: boolean
  setDeliveredAt?: boolean
  clearAwb?: boolean
  onlyIfCurrent?: string[]
}> = {
  PU:       { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  IT:       { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT:       { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  OD:       { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DL:       { orderStatus: 'delivered',        setDeliveredAt: true, onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-DL': { orderStatus: 'returned',         clearAwb: true,       onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing'] },
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!DELHIVERY_TOKEN) {
    return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })
  }

  const orders = await queryMany<{ id: string; awb_number: string; status: string }>(
    `SELECT id, awb_number, status FROM orders
     WHERE awb_number IS NOT NULL
       AND status IN ('processing', 'confirmed', 'pending', 'shipped', 'out_for_delivery')
     ORDER BY updated_at DESC`,
    []
  )

  if (orders.length === 0) {
    return NextResponse.json({ synced: 0, total: 0 })
  }

  const BATCH_SIZE = 25
  const results: { orderId: string; awb: string; syncedTo: string }[] = []
  const errors: { awb: string; error: string }[] = []

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE)
    const waybills = batch.map(o => o.awb_number).join(',')

    try {
      const res = await fetch(
        `https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(waybills)}`,
        { headers: { Authorization: `Token ${DELHIVERY_TOKEN}` } }
      )

      if (!res.ok) {
        batch.forEach(o => errors.push({ awb: o.awb_number, error: `HTTP ${res.status}` }))
        continue
      }

      const data = await res.json()
      const shipments: any[] = data?.ShipmentData ?? []

      for (const entry of shipments) {
        const shipment = entry?.Shipment
        if (!shipment) continue

        const awb: string = shipment.AWB
        const order = batch.find(o => o.awb_number === awb)
        if (!order) continue

        const rawType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
        const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])
        let statusType = rawType
        if (EXCEPTION_TYPES.has(rawType)) {
          const scans: any[] = shipment.Scans ?? []
          for (let i = scans.length - 1; i >= 0; i--) {
            const t = (scans[i]?.ScanDetail?.ScanType ?? '').toUpperCase()
            if (t && !EXCEPTION_TYPES.has(t)) { statusType = t; break }
          }
        }
        const statusDateTime: string | null = shipment.Status?.StatusDateTime ?? null
        const syncRule = STATUS_SYNC[statusType]

        if (!syncRule) continue
        if (syncRule.onlyIfCurrent && !syncRule.onlyIfCurrent.includes(order.status)) continue

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

        const queryParams: any[] = [order.id]
        if ((syncRule.setShippedAt || syncRule.setDeliveredAt) && statusDateTime) {
          queryParams.push(statusDateTime)
        }

        await query(
          `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1`,
          queryParams
        ).catch(() => {})

        results.push({ orderId: order.id, awb, syncedTo: syncRule.orderStatus })
      }
    } catch (err: any) {
      batch.forEach(o => errors.push({ awb: o.awb_number, error: err.message }))
    }
  }

  return NextResponse.json({
    total: orders.length,
    synced: results.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  })
}
