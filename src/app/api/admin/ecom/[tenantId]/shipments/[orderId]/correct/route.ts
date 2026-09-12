import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { isPlatformAdmin } from '@/lib/scopes'
import { parseBody } from '@/lib/validate'
import { getTenant, lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenant-context'
import { queryOne, query } from '@/lib/db'
import { logAdminAudit } from '@/lib/admin-audit'
import { settleDelhiveryCostToWallet, correctWalletDebitForAwb } from '@/lib/wallet'

export const dynamic = 'force-dynamic'

// Platform-admin correction of a shipment's real Delhivery charge from the tenant-detail page on
// admin.jeffistores.in. The per-order delivery-charge route derives the tenant from ALS, which is the
// platform on this host — so we resolve the target tenant's context by id and run the tenant-DB
// update + wallet movement inside it. First set (no delhivery_billed_at) settles one-shot; a
// re-price (already billed) posts a net wallet adjustment via correctWalletDebitForAwb.
const Schema = z.object({
  chargedAmount: z.number().nonnegative().max(1_000_000),
  proofNote: z.string().trim().min(1).max(500),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId, orderId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.own_delhivery === true) {
    return NextResponse.json({ error: 'Own-Delhivery tenants are billed by Delhivery directly; no wallet correction applies.' }, { status: 409 })
  }

  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { chargedAmount, proofNote } = parsed.data

  const ctx = await lookupTenantContextById(tenantId).catch(() => null)
  if (!ctx) return NextResponse.json({ error: 'Tenant has no active database to correct against.' }, { status: 409 })

  const result = await runWithTenantContext(ctx, async () => {
    const order = await queryOne<{
      awb_number: string | null
      order_number: string | null
      shipping_amount: string | null
      delhivery_billed_at: string | null
    }>(
      `SELECT awb_number, order_number, shipping_amount, delhivery_billed_at
         FROM orders WHERE id = $1`,
      [orderId]
    )
    if (!order) return { status: 404 as const, error: 'Order not found' }
    if (!order.awb_number) return { status: 400 as const, error: 'Order has no AWB' }

    const isCorrection = order.delhivery_billed_at != null
    const walletNote = `Delhivery charge ${isCorrection ? 'correction' : 'set'} — AWB ${order.awb_number} — ${proofNote}`

    let settled = true
    if (chargedAmount > 0) {
      if (isCorrection) {
        const res = await correctWalletDebitForAwb({
          tenantId, awb: order.awb_number, orderRef: order.order_number,
          newAmountInr: chargedAmount, note: walletNote,
        }).catch(() => ({ ok: false as const, error: 'wallet correction failed' }))
        settled = res.ok
      } else {
        settled = await settleDelhiveryCostToWallet({
          tenantId, awb: order.awb_number, orderRef: order.order_number, amountInr: chargedAmount,
        }).catch(() => false)
      }
    }

    await query(
      `UPDATE orders SET
         delhivery_billed_amount = $2,
         delhivery_billed_at     = CASE WHEN $3 THEN NOW() ELSE delhivery_billed_at END,
         delhivery_extra_charge  = ROUND(($2 - COALESCE(shipping_amount, 0))::numeric, 2),
         updated_at              = NOW()
       WHERE id = $1`,
      [orderId, chargedAmount, settled]
    )

    return {
      status: 200 as const,
      quoted: Number(order.shipping_amount ?? 0),
      awb: order.awb_number,
      isCorrection,
    }
  }).catch(() => ({ status: 500 as const, error: 'Correction failed' }))

  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'order',
    entityId: orderId,
    summary: `Delivery charge ${result.isCorrection ? 'corrected' : 'set'} to ₹${chargedAmount} (quoted ₹${result.quoted}) for tenant ${tenant.slug}`,
    diff: { delhivery_billed_amount: { from: null, to: chargedAmount } },
    metadata: { tenantId, awb: result.awb, source: 'platform-admin', correction: result.isCorrection, proofNote },
    request,
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    charged: chargedAmount,
    quoted: result.quoted,
    difference: Math.round((chargedAmount - result.quoted) * 100) / 100,
  })
}
