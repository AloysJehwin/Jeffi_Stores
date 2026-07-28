import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { resolveShipmentStatus, isAdvancement, shipmentStatusToSyncType, rankOf } from '@/lib/shipment-status'
import { restoreOrderStock } from '@/lib/order-stock'

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
  RAD:      { orderStatus: 'shipped',          setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending'] },
  OT:       { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  OD:       { orderStatus: 'out_for_delivery', setShippedAt: true,   onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DISPATCHED:{ orderStatus: 'out_for_delivery', setShippedAt: true,  onlyIfCurrent: ['processing', 'confirmed', 'pending', 'shipped'] },
  DL:       { orderStatus: 'delivered',        setDeliveredAt: true, onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTO:      { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  RTRN:     { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-IT': { orderStatus: 'shipped',                                onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OT': { orderStatus: 'out_for_delivery',                      onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
  'RTO-OFD':{ orderStatus: 'out_for_delivery',                      onlyIfCurrent: ['out_for_delivery', 'shipped', 'processing', 'confirmed'] },
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

  const orders = await queryMany<{
    id: string; awb_number: string; status: string; shipment_status: string | null
    order_number: string; customer_name: string; customer_email: string
    user_id: string | null; payment_mode: string | null
  }>(
    `SELECT o.id, o.awb_number, o.status, o.shipment_status, o.order_number, o.user_id,
            o.payment_mode,
            COALESCE(u.first_name || ' ' || u.last_name, o.customer_name) AS customer_name,
            COALESCE(u.email, o.customer_email) AS customer_email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.awb_number IS NOT NULL
       AND o.status IN ('processing', 'confirmed', 'pending', 'shipped', 'out_for_delivery')
     ORDER BY o.updated_at DESC`,
    []
  )

  if (orders.length === 0) {
    return NextResponse.json({ synced: 0, total: 0 })
  }

  const BATCH_SIZE = 25
  const results: { orderId: string; awb: string; syncedTo: string }[] = []
  const errors: { awb: string; error: string }[] = []
  const pickedUpAwbs = new Set<string>()

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
        const statusDateTime: string | null = shipment.Status?.StatusDateTime ?? null
        const delhiveryEdd: string | null = shipment.ExpectedDeliveryDate ?? null

        const rawScans: any[] = shipment.Scans ?? []
        const scans = rawScans.map((s: any) => ({
          activity: s.ScanDetail?.Scan ?? null,
          scanType: s.ScanDetail?.ScanType ?? null,
          instructions: s.ScanDetail?.Instructions ?? null,
          date: s.ScanDetail?.ScanDateTime ?? null,
        }))

        // Resolve stable internal status (shared lib — same logic as admin track route)
        const newShipmentStatus = resolveShipmentStatus(rawType, scans, shipment.Status?.Status ?? null)

        // Derive the STATUS_SYNC key from the RESOLVED status via the shared mapper
        // (single source of truth; keeps cron and the on-demand track route in lockstep).
        const statusType = shipmentStatusToSyncType(newShipmentStatus)
        const syncRule = statusType ? STATUS_SYNC[statusType] : undefined

        // A shipment is "picked up" once it reached at least the picked_up stage.
        if (rankOf(newShipmentStatus) >= rankOf('picked_up')) {
          pickedUpAwbs.add(awb)
        }

        // Always advance shipment_status for every shipment we fetched
        if (isAdvancement(order.shipment_status as any, newShipmentStatus)) {
          await query(
            `UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`,
            [order.id, newShipmentStatus]
          ).catch(() => {})
        }

        // Always update EDD when Delhivery provides one — independent of status
        // transitions. COALESCE is intentionally NOT used here; Delhivery revises
        // EDD as the shipment moves, and we want the latest estimate reflected.
        if (delhiveryEdd) {
          await query(
            `UPDATE orders SET estimated_delivery_date = $2::date, updated_at = NOW() WHERE id = $1`,
            [order.id, delhiveryEdd]
          ).catch(() => {})
        }

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

        // COD orders: flip payment_status to cod_collected on delivery
        if (syncRule.orderStatus === 'delivered' && order.payment_mode === 'cod') {
          await query(
            `UPDATE orders SET payment_status = 'cod_collected', updated_at = NOW() WHERE id = $1 AND payment_status = 'cod_pending'`,
            [order.id]
          ).catch(() => {})
        }

        if (order.customer_email && order.customer_name) {
          sendOrderStatusUpdate(
            order.customer_email, order.customer_name,
            order.order_number, order.id,
            syncRule.orderStatus, order.status
          ).catch(() => {})
        }

        if (syncRule.orderStatus === 'returned') {
          restoreOrderStock(order.id).catch(() => {})
        }

        if (rawType.startsWith('RTO') && order.user_id) {
          createAutoTask({
            userId: order.user_id,
            sourceKind: 'address_rto',
            sourceRefId: order.id,
            title: `Address RTO for #${order.order_number}`,
            description: `Delhivery reported ${rawType}. Decide whether to refund or redispatch and contact the customer.`,
            priority: 'high',
            dueInDays: 1,
          }).catch(() => {})
        }

        results.push({ orderId: order.id, awb, syncedTo: syncRule.orderStatus })
      }
    } catch (err: any) {
      batch.forEach(o => errors.push({ awb: o.awb_number, error: err.message }))
    }
  }

  // Auto-update pickup request status: if any AWB in a pending request has been
  // picked up (PU/IT/OT/OD/DL or RTO variants), mark the whole request picked_up.
  if (pickedUpAwbs.size > 0) {
    const awbList = Array.from(pickedUpAwbs)
    await query(
      `UPDATE delhivery_pickup_requests
       SET pickup_status = 'picked_up', updated_at = NOW()
       WHERE pickup_status = 'pending'
         AND awbs && $1::text[]`,
      [awbList]
    ).catch(() => {})
  }

  const rvpRequests = await queryMany<{
    id: string; rvp_awb_number: string; order_id: string;
    user_id: string | null; order_number: string
  }>(
    `SELECT rr.id, rr.rvp_awb_number, rr.order_id,
            o.user_id, o.order_number
     FROM return_requests rr
     LEFT JOIN orders o ON o.id = rr.order_id
     WHERE rr.rvp_awb_number IS NOT NULL
       AND rr.status = 'approved'
       AND rr.received_at IS NULL`,
    []
  ).catch(() => [] as { id: string; rvp_awb_number: string; order_id: string; user_id: string | null; order_number: string }[])

  const rvpResults: { returnRequestId: string; awb: string; receivedAt: boolean }[] = []
  const rvpErrors: { awb: string; error: string }[] = []

  for (let i = 0; i < rvpRequests.length; i += BATCH_SIZE) {
    const batch = rvpRequests.slice(i, i + BATCH_SIZE)
    const waybills = batch.map(r => r.rvp_awb_number).join(',')

    try {
      const res = await fetch(
        `https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(waybills)}`,
        { headers: { Authorization: `Token ${DELHIVERY_TOKEN}` } }
      )

      if (!res.ok) {
        batch.forEach(r => rvpErrors.push({ awb: r.rvp_awb_number, error: `HTTP ${res.status}` }))
        continue
      }

      const data = await res.json()
      const shipments: any[] = data?.ShipmentData ?? []

      for (const entry of shipments) {
        const shipment = entry?.Shipment
        if (!shipment) continue

        const awb: string = shipment.AWB
        const rr = batch.find(r => r.rvp_awb_number === awb)
        if (!rr) continue

        const statusLabel: string = (shipment.Status?.Status ?? '').toLowerCase()
        const statusDateTime: string | null = shipment.Status?.StatusDateTime ?? null
        const destReceiveDate: string | null = shipment.DestRecieveDate ?? null
        const returnedDate: string | null = shipment.ReturnedDate ?? null

        const isReceivedAtWarehouse =
          destReceiveDate !== null ||
          returnedDate !== null ||
          statusLabel === 'delivered'

        if (!isReceivedAtWarehouse) continue

        const receivedAt = destReceiveDate ?? returnedDate ?? statusDateTime ?? new Date().toISOString()

        await query(
          `UPDATE return_requests SET received_at = $2, updated_at = NOW() WHERE id = $1`,
          [rr.id, receivedAt]
        ).catch(() => {})

        if (rr.user_id) {
          completeAutoTask('schedule_pickup', rr.order_id).catch(() => {})
          createAutoTask({
            userId: rr.user_id,
            sourceKind: 'inspect_refund',
            sourceRefId: rr.order_id,
            title: `Inspect returned item & process refund for #${rr.order_number}`,
            description: 'RVP package received at warehouse. Inspect condition and issue refund.',
            priority: 'high',
            dueInDays: 2,
          }).catch(() => {})
        }

        rvpResults.push({ returnRequestId: rr.id, awb, receivedAt: true })
      }
    } catch (err: any) {
      batch.forEach(r => rvpErrors.push({ awb: r.rvp_awb_number, error: err.message }))
    }
  }

  return NextResponse.json({
    total: orders.length,
    synced: results.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
    rvp: {
      total: rvpRequests.length,
      received: rvpResults.length,
      results: rvpResults,
      errors: rvpErrors.length > 0 ? rvpErrors : undefined,
    },
  })
}
