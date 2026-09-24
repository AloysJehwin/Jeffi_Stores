import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { resolveTenantId } from '@/lib/tenant-context'
import { correctWalletDebitForAwb } from '@/lib/wallet'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

// The store admin enters/updates the calculated delivery charge for a reverse pickup (RVP). Reverse
// legs have no customer-quoted shipping, so the amount is admin-entered here, then debited from the
// tenant wallet keyed to the RVP AWB. Uses correctWalletDebitForAwb so a re-save nets the AWB to the
// new amount (not a second debit). Platform-Delhivery tenants only; own_delhivery is exempt inside
// the helper. Refunded if the RVP AWB is later cancelled.
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

    const rr = await queryOne<{ id: string; rvp_awb_number: string | null; order_id: string; order_number: string; user_id: string | null }>(
      `SELECT rr.id, rr.rvp_awb_number, rr.order_id, o.order_number, o.user_id
       FROM return_requests rr JOIN orders o ON o.id = rr.order_id
       WHERE rr.id = $1`,
      [id]
    )
    if (!rr) return NextResponse.json({ error: 'Return request not found' }, { status: 404 })
    if (!rr.rvp_awb_number) {
      return NextResponse.json({ error: 'Create the RVP shipment (AWB) before setting its delivery charge.' }, { status: 409 })
    }

    await query(`UPDATE return_requests SET rvp_delivery_charge = $1, updated_at = NOW() WHERE id = $2`, [charge, id])

    const tenantId = (await resolveTenantId().catch(() => null)) ?? undefined
    let walletResult: { ok: boolean; error?: string; outcome?: string } = { ok: true }
    if (tenantId && charge > 0) {
      const res = await correctWalletDebitForAwb({
        tenantId,
        awb: rr.rvp_awb_number,
        orderRef: rr.order_number,
        newAmountInr: charge,
        note: `RVP delivery charge — AWB ${rr.rvp_awb_number}`,
      }).catch(() => ({ ok: false as const, error: 'wallet charge failed' }))
      walletResult = res.ok ? { ok: true, outcome: (res as any).outcome } : { ok: false, error: (res as any).error }
    }

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
      walletCharged: walletResult.ok,
      walletWarning: walletResult.ok ? undefined : (walletResult.error || 'Charge could not be applied to the wallet.'),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
