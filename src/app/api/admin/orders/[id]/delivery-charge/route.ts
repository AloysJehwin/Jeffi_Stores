import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { parseBody } from '@/lib/validate'
import { fetchDelhiveryInvoiceCharges } from '@/lib/delhivery'
import { getBusinessValues } from '@/lib/site-controls'
import { logAdminAudit } from '@/lib/admin-audit'
import { resolveTenantId } from '@/lib/tenant-context'
import { settleDelhiveryCostToWallet, correctWalletDebitForAwb } from '@/lib/wallet'

export const dynamic = 'force-dynamic'

/**
 * Record Delhivery's revised charged weight for a shipment and price it.
 *
 * Delhivery reprices a shipment when its measured weight differs from what was declared, but
 * does not expose the revised weight on this account: Shipment.ChargedWeight comes back null on
 * every AWB, delivered or in transit, and the weight-discrepancy endpoints 404. The operator
 * reads it off the Delhivery dashboard ("Updated charged weight") and enters it here.
 *
 * The charge itself is NOT typed in — it is computed from the same rate API Delhivery's own
 * dashboard uses, so the stored figure matches theirs exactly rather than being someone's
 * arithmetic.
 */
const Schema = z.object({
  chargedWeightKg: z.number().positive().max(1000).nullish(),
  chargedAmount: z.number().nonnegative().max(1_000_000).nullish(),
  proofNote: z.string().trim().max(500).nullish(),
}).refine((v) => v.chargedWeightKg != null || v.chargedAmount != null, {
  message: 'Give the charged weight, the charged amount, or both',
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { chargedWeightKg, chargedAmount, proofNote } = parsed.data

  const order = await queryOne<{
    awb_number: string | null
    order_number: string | null
    payment_mode: string | null
    shipping_amount: string | null
    dest_pin: string | null
    delhivery_charged_weight_kg: string | null
    delhivery_billed_at: string | null
  }>(
    `SELECT awb_number, order_number, payment_mode, shipping_amount,
            shipping_address_snapshot->>'postal_code' AS dest_pin,
            delhivery_charged_weight_kg,
            delhivery_billed_at
       FROM orders WHERE id = $1`,
    [id]
  )

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.awb_number) return NextResponse.json({ error: 'Order has no AWB' }, { status: 400 })
  if (!order.dest_pin) return NextResponse.json({ error: 'Order has no destination pincode' }, { status: 400 })

  // An amount read straight off Delhivery is the billed figure itself, so it wins over anything
  // derived. The rate call only runs when we have a weight and no amount to trust.
  let charges: Awaited<ReturnType<typeof fetchDelhiveryInvoiceCharges>> = null
  if (chargedAmount == null && chargedWeightKg != null) {
    charges = await fetchDelhiveryInvoiceCharges({
      awb: order.awb_number,
      settledStatus: 'Delivered',
      chargedWeightG: Math.round(chargedWeightKg * 1000),
      originPin: (await getBusinessValues()).delhiveryOriginPincode,
      destPin: order.dest_pin,
      paymentType: order.payment_mode === 'cod' ? 'COD' : 'Pre-paid',
    })

    if (!charges) {
      return NextResponse.json(
        { error: 'Delhivery did not return a rate for this weight. Enter the charged amount instead, or check the server log.' },
        { status: 502 }
      )
    }
  }

  const total = chargedAmount ?? charges!.total

  // Debit the tenant's prepaid wallet by the real Delhivery cost first (own_delhivery tenants are
  // exempt inside both wallet helpers, which then succeed with no ledger movement). Only stamp
  // billed_at when the charge is durably settled, so a transient failure leaves it NULL and the next
  // sync retries instead of silently losing the charge.
  //
  // First settlement (no delhivery_billed_at) goes through settleDelhiveryCostToWallet, whose
  // one-shot (tenant_id, awb) index keeps re-runs idempotent. A correction (the charge was already
  // billed once, so the operator is re-pricing post-pickup) goes through correctWalletDebitForAwb,
  // which posts a net adjustment refunding the initial debit and re-debiting the actual amount — the
  // one-shot debit would otherwise no-op and the wallet would never reflect the new price.
  const tenantId = await resolveTenantId()
  const isCorrection = order.delhivery_billed_at != null
  const walletNote = proofNote
    ? `Delhivery charge ${isCorrection ? 'correction' : ''} — AWB ${order.awb_number} — ${proofNote}`
    : undefined
  let settled = true
  if (tenantId && order.awb_number && total > 0) {
    if (isCorrection) {
      const res = await correctWalletDebitForAwb({
        tenantId,
        awb: order.awb_number,
        orderRef: order.order_number,
        newAmountInr: total,
        note: walletNote,
      }).catch(() => ({ ok: false as const, error: 'wallet correction failed' }))
      settled = res.ok
    } else {
      settled = await settleDelhiveryCostToWallet({
        tenantId,
        awb: order.awb_number,
        orderRef: order.order_number,
        amountInr: total,
      }).catch(() => false)
    }
  }

  await query(
    `UPDATE orders SET
       delhivery_charged_weight_kg = COALESCE($2, delhivery_charged_weight_kg),
       delhivery_billed_amount     = $3,
       delhivery_freight_charge    = $4,
       delhivery_cod_charge        = $5,
       delhivery_oda_charge        = $6,
       delhivery_billed_at         = CASE WHEN $7 THEN NOW() ELSE delhivery_billed_at END,
       delhivery_extra_charge      = ROUND(($3 - COALESCE(shipping_amount, 0))::numeric, 2),
       updated_at                  = NOW()
     WHERE id = $1`,
    [id, chargedWeightKg ?? null, total, charges?.freight ?? null, charges?.codCharge ?? null, charges?.oda ?? null, settled]
  )

  const quoted = Number(order.shipping_amount ?? 0)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'order',
    entityId: id,
    summary: `Delivery charge ${isCorrection ? 'corrected' : 'set'} to ₹${total} (quoted ₹${quoted})`
      + (chargedAmount != null ? ' — entered' : ` — calculated at ${chargedWeightKg} kg`),
    diff: {
      delhivery_charged_weight_kg: { from: order.delhivery_charged_weight_kg, to: chargedWeightKg ?? order.delhivery_charged_weight_kg },
      delhivery_billed_amount: { from: null, to: total },
    },
    metadata: {
      awb: order.awb_number,
      source: chargedAmount != null ? 'entered' : 'calculated',
      correction: isCorrection,
      proofNote: proofNote ?? null,
      zone: charges?.zone ?? null, freight: charges?.freight ?? null, tax: charges?.tax ?? null,
    },
    request,
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    chargedWeightKg: chargedWeightKg ?? null,
    quoted,
    charged: total,
    source: chargedAmount != null ? 'entered' : 'calculated',
    difference: Math.round((total - quoted) * 100) / 100,
    breakdown: charges,
  })
}
