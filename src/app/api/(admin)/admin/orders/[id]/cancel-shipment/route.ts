import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { refundEstimateForAwbs } from '@/lib/payments/wallet'
import { rankOf, type ShipmentStatus } from '@/lib/shipping/shipment-status'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const tenantId = (await resolveTenantId().catch(() => null)) ?? undefined
    const TOKEN = await resolveDelhiveryToken(tenantId)
    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null; order_number: string; shipment_status: string | null }>(
      'SELECT awb_number, order_number, shipment_status FROM orders WHERE id = $1',
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const res = await fetch(DELHIVERY_EDIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ waybill: order.awb_number, cancellation: 'true' }),
      next: { revalidate: 0 },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Delhivery cancellation failed', details: JSON.stringify(data) },
        { status: 502 }
      )
    }

    const cancelledAwb = order.awb_number
    await query(`UPDATE orders SET awb_number = NULL, updated_at = NOW() WHERE id = $1`, [id])

    // Pre-pickup cancel releases the wallet hold. After pickup Delhivery turns it into an RTO and
    // still bills it, so the hold stays until the billing true-up.
    const prePickup = rankOf((order.shipment_status ?? null) as ShipmentStatus | null) < rankOf('picked_up')
    if (tenantId && prePickup) await refundEstimateForAwbs({ tenantId, awbs: [cancelledAwb] }).catch(() => {})

    return NextResponse.json({ success: true, waybill: cancelledAwb, raw: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
