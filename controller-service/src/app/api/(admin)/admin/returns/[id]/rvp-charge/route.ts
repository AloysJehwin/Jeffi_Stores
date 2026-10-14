import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { tenantShipsOnPlatform } from '@/lib/payments/wallet'
import { logActivity } from '@/lib/shared/activity'

export const dynamic = 'force-dynamic'

// The store admin records the delivery charge of a reverse pickup (RVP) for its own books. It never
// moves the wallet: a platform-account RVP is charged an estimate at AWB creation and netted to
// Delhivery's bill by the platform (a tenant must not price its own wallet charges).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const charge = Number(body?.charge)
    if (!(charge >= 0) || !Number.isFinite(charge)) {
      return NextResponse.json({ error: 'A valid delivery charge (0 or more) is required.' }, { status: 400 })
    }

    const rr = await queryOne<{
      id: string
      rvp_awb_number: string | null
      order_id: string
      order_number: string
      user_id: string | null
    }>(
      `SELECT rr.id, rr.rvp_awb_number, rr.order_id, o.order_number, o.user_id
       FROM return_requests rr JOIN orders o ON o.id = rr.order_id
       WHERE rr.id = $1`,
      [id]
    )
    if (!rr) return NextResponse.json({ error: 'Return request not found' }, { status: 404 })
    if (!rr.rvp_awb_number) {
      return NextResponse.json(
        { error: 'Create the RVP shipment (AWB) before setting its delivery charge.' },
        { status: 409 }
      )
    }

    await query(`UPDATE return_requests SET rvp_delivery_charge = $1, updated_at = NOW() WHERE id = $2`, [charge, id])

    const onPlatform = await tenantShipsOnPlatform((await resolveTenantId().catch(() => null)) ?? undefined)

    if (rr.user_id) {
      logActivity({
        userId: rr.user_id,
        actorId: admin.adminId,
        kind: 'return_status',
        referenceId: rr.order_id,
        referenceType: 'orders',
        summary: `RVP delivery charge set to Rs ${charge.toFixed(2)} for #${rr.order_number}`,
        metadata: { rvp_delivery_charge: charge, awb: rr.rvp_awb_number },
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      charge,
      walletCharged: false,
      walletWarning: onPlatform
        ? 'The wallet already holds an estimate for this return pickup; the platform settles it to Delhivery\'s bill.'
        : undefined,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
