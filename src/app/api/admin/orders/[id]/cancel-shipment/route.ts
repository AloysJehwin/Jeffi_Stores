import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { resolveTenantId } from '@/lib/tenant-context'
import { refundEstimateForAwbs } from '@/lib/wallet'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const TOKEN = await resolveDelhiveryToken()
    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null; order_number: string }>(
      'SELECT awb_number, order_number FROM orders WHERE id = $1',
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

    // The AWB is cancelled, so refund any pickup estimate held for it (platform-Delhivery tenants;
    // own_delhivery never had a debit → no-op). Reconciliation at delivery can no longer fire for a
    // cancelled AWB, so this is the release point for that hold. Best-effort — never fail the cancel.
    const tenantId = (await resolveTenantId().catch(() => null)) ?? undefined
    if (tenantId) await refundEstimateForAwbs({ tenantId, awbs: [cancelledAwb] }).catch(() => {})

    return NextResponse.json({ success: true, waybill: cancelledAwb, raw: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
