import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { resolveTenantId } from '@/lib/tenant-context'
import { getBusinessValues } from '@/lib/site-controls'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { listDelhiveryPickupLocations } from '@/lib/delhivery'
import { walletBlocksShipment } from '@/lib/wallet'

const DELHIVERY_PICKUP_URL = 'https://track.delhivery.com/fm/request/new/'

const EXCLUDE_STATUSES = ['shipped', 'delivered', 'cancelled', 'returned', 'return_requested', 'return_approved', 'return_received', 'return_rejected']

// AWB status types that indicate the shipment has been physically picked up
const PICKED_UP_TYPES = new Set(['PU', 'IT', 'RAD', 'OT', 'OD', 'DL', 'RTO', 'RTRN', 'RTO-IT', 'RTO-OT', 'RTO-OFD', 'RTO-DL'])
const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])

/** Resolve a Delhivery rawStatusType to a canonical code (walks scans for ambiguous types) */
function resolveStatusCode(rawType: string, scans: { scanType?: string | null; activity?: string | null }[]): string {
  if (!EXCEPTION_TYPES.has(rawType) && rawType !== 'PP' && rawType !== 'MF') return rawType
  for (const scan of [...scans].reverse()) {
    const t = (scan.scanType ?? '').toUpperCase()
    if (t && !EXCEPTION_TYPES.has(t) && t !== 'PP' && t !== 'MF') return t
    const a = (scan.activity ?? '').toLowerCase()
    if (a.includes('out for delivery')) return 'OD'
    if (a.includes('rto delivered') || a.includes('returned to origin')) return 'RTO-DL'
    if (a.includes('out for return')) return 'RTO-OT'
    if (a.includes('return in transit') || a.includes('in return transit')) return 'RTO-IT'
    if (a.includes('rto initiated') || a.includes('return initiated')) return 'RTO'
    if (a.includes('in transit') || a === 'transit') return 'IT'
    if (a.includes('picked up') || a.includes('shipment picked') || a.includes('pickup')) return 'PU'
    if (a === 'manifested' || a.includes('manifest')) return 'MF'
    if (a.includes('delivered')) return 'DL'
  }
  return rawType
}

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'delhivery:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    // ?poll=<db_id> — fetch live AWB status for a specific pickup request
    const pollId = request.nextUrl.searchParams.get('poll')
    if (pollId) {
      const token = await resolveDelhiveryToken((await resolveTenantId()) ?? undefined)
      if (!token) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

      const req = await queryOne<{ id: string; awbs: string[]; pickup_status: string }>(
        `SELECT id, awbs, pickup_status FROM delhivery_pickup_requests WHERE id = $1`,
        [pollId]
      )
      if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      if (req.awbs.length === 0) return NextResponse.json({ pickup_status: req.pickup_status, updated: false })

      const res = await fetch(
        `https://track.delhivery.com/api/v1/packages/json/?waybill=${req.awbs.join(',')}`,
        { headers: { Authorization: `Token ${token}` }, next: { revalidate: 0 } }
      )
      if (!res.ok) return NextResponse.json({ error: 'Tracking unavailable' }, { status: 502 })

      const data = await res.json()
      const shipments: any[] = data?.ShipmentData ?? []

      let anyPickedUp = false
      for (const entry of shipments) {
        const shipment = entry?.Shipment
        if (!shipment) continue
        const rawType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
        const scans = (shipment.Scans ?? []).map((s: any) => ({
          scanType: s.ScanDetail?.ScanType ?? null,
          activity: s.ScanDetail?.Scan ?? null,
        }))
        const resolved = resolveStatusCode(rawType, scans)
        if (PICKED_UP_TYPES.has(resolved)) { anyPickedUp = true; break }
      }

      let newStatus = req.pickup_status
      if (anyPickedUp && req.pickup_status === 'pending') {
        await query(
          `UPDATE delhivery_pickup_requests SET pickup_status = 'picked_up' WHERE id = $1`,
          [pollId]
        )
        newStatus = 'picked_up'
      }

      return NextResponse.json({ pickup_status: newStatus, updated: newStatus !== req.pickup_status })
    }

    const [orders, pickupHistory] = await Promise.all([
      queryMany(`
        SELECT o.id, o.order_number, o.awb_number, o.status, o.created_at,
               o.customer_name, sa.city, sa.state, sa.postal_code
        FROM orders o
        LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
        WHERE o.awb_number IS NOT NULL
          AND o.payment_status = 'paid'
          AND o.status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
          AND o.awb_number NOT IN (
            SELECT UNNEST(awbs) FROM delhivery_pickup_requests
            WHERE pickup_status IN ('pending', 'picked_up')
          )
        ORDER BY o.created_at DESC
        LIMIT 100
      `, [...EXCLUDE_STATUSES]),
      queryMany(`
        SELECT id, pickup_id, pickup_date, awb_count, awbs, raw_response, pickup_status, created_at
        FROM delhivery_pickup_requests
        ORDER BY created_at DESC
        LIMIT 20
      `, []),
    ])

    return NextResponse.json({ orders: orders || [], pickupHistory: pickupHistory || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { id, pickup_status, add_awb_order_id } = body

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    if (add_awb_order_id) {
      const order = await queryMany(`
        SELECT id, awb_number FROM orders
        WHERE id = $1
          AND awb_number IS NOT NULL
          AND payment_status = 'paid'
          AND status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
          AND awb_number NOT IN (
            SELECT UNNEST(awbs) FROM delhivery_pickup_requests
            WHERE pickup_status IN ('pending', 'picked_up')
          )
      `, [add_awb_order_id, ...EXCLUDE_STATUSES])

      if (!order || order.length === 0) {
        return NextResponse.json({ error: 'Order not eligible to add to pickup' }, { status: 422 })
      }

      const awb = (order[0] as any).awb_number as string

      await query(
        `UPDATE delhivery_pickup_requests
         SET awbs = array_append(awbs, $1), awb_count = awb_count + 1
         WHERE id = $2 AND pickup_status = 'pending'`,
        [awb, id]
      )

      return NextResponse.json({ success: true, awb })
    }

    if (!['pending', 'picked_up', 'failed'].includes(pickup_status)) {
      return NextResponse.json({ error: 'Invalid pickup_status' }, { status: 400 })
    }

    await query(
      `UPDATE delhivery_pickup_requests SET pickup_status = $1 WHERE id = $2`,
      [pickup_status, id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const tenantId = (await resolveTenantId()) ?? undefined
    if (tenantId && await walletBlocksShipment(tenantId).catch(() => false)) {
      return NextResponse.json(
        { error: 'Wallet balance is below the minimum. Recharge the wallet before requesting pickups.' },
        { status: 402 }
      )
    }

    const token = await resolveDelhiveryToken(tenantId)
    if (!token) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const bv = await getBusinessValues()

    const body = await request.json()
    const { orderIds, pickupDate, pickupLocation: requestedLocation } = body

    let pickupLocation = bv.pickupLocation
    if (requestedLocation) {
      const known = await listDelhiveryPickupLocations(tenantId).catch(() => [])
      if (known.some(l => l.name === requestedLocation)) pickupLocation = requestedLocation
    }

    if (!orderIds?.length) return NextResponse.json({ error: 'No orders selected' }, { status: 400 })
    if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
      return NextResponse.json({ error: 'Invalid pickup date' }, { status: 400 })
    }

    const eligible = await queryMany(`
      SELECT id, awb_number FROM orders
      WHERE id = ANY($1::uuid[])
        AND awb_number IS NOT NULL
        AND payment_status = 'paid'
        AND status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
    `, [orderIds, ...EXCLUDE_STATUSES])

    if (!eligible || eligible.length === 0) {
      return NextResponse.json({ error: 'No eligible orders found (must have AWB, be paid, not yet shipped/cancelled)' }, { status: 422 })
    }

    const awbList = eligible.map((o: any) => o.awb_number as string)

    const res = await fetch(DELHIVERY_PICKUP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pickup_time: '14:00:00',
        pickup_date: pickupDate,
        pickup_location: pickupLocation,
        expected_package_count: awbList.length,
      }),
      next: { revalidate: 0 },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok || data.error) {
      return NextResponse.json({
        error: 'Delhivery rejected the pickup request',
        details: data.error || data.prepaid || JSON.stringify(data),
      }, { status: 422 })
    }

    const pickupId = data.pickup_id ?? null

    await query(
      `INSERT INTO delhivery_pickup_requests (pickup_id, pickup_date, awb_count, awbs, raw_response, pickup_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [pickupId, pickupDate, awbList.length, awbList, JSON.stringify(data)]
    )

    for (const ord of eligible) {
      await query(
        `UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status NOT IN ('processing','shipped','delivered')`,
        [ord.id]
      )
    }

    return NextResponse.json({
      pickupId,
      pickupDate,
      orderCount: eligible.length,
      awbs: eligible.map((o: any) => o.awb_number),
      raw: data,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
