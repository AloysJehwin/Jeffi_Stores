import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { parseBody } from '@/lib/validate'
import { fetchDelhiveryInvoiceCharges } from '@/lib/delhivery'
import { getBusinessValues } from '@/lib/site-controls'
import { logAdminAudit } from '@/lib/admin-audit'

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
  chargedWeightKg: z.number().positive().max(1000),
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
  const { chargedWeightKg } = parsed.data

  const order = await queryOne<{
    awb_number: string | null
    payment_mode: string | null
    shipping_amount: string | null
    dest_pin: string | null
    delhivery_charged_weight_kg: string | null
  }>(
    `SELECT awb_number, payment_mode, shipping_amount,
            shipping_address_snapshot->>'postal_code' AS dest_pin,
            delhivery_charged_weight_kg
       FROM orders WHERE id = $1`,
    [id]
  )

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.awb_number) return NextResponse.json({ error: 'Order has no AWB' }, { status: 400 })
  if (!order.dest_pin) return NextResponse.json({ error: 'Order has no destination pincode' }, { status: 400 })

  const charges = await fetchDelhiveryInvoiceCharges({
    awb: order.awb_number,
    settledStatus: 'Delivered',
    chargedWeightG: Math.round(chargedWeightKg * 1000),
    originPin: (await getBusinessValues()).delhiveryOriginPincode,
    destPin: order.dest_pin,
    paymentType: order.payment_mode === 'cod' ? 'COD' : 'Pre-paid',
  })

  if (!charges) {
    return NextResponse.json(
      { error: 'Delhivery did not return a rate for this shipment. Check the server log for the reason.' },
      { status: 502 }
    )
  }

  await query(
    `UPDATE orders SET
       delhivery_charged_weight_kg = $2,
       delhivery_billed_amount     = $3,
       delhivery_freight_charge    = $4,
       delhivery_cod_charge        = $5,
       delhivery_oda_charge        = $6,
       delhivery_billed_at         = NOW(),
       delhivery_extra_charge      = ROUND(($3 - COALESCE(shipping_amount, 0))::numeric, 2),
       updated_at                  = NOW()
     WHERE id = $1`,
    [id, chargedWeightKg, charges.total, charges.freight, charges.codCharge, charges.oda]
  )

  const quoted = Number(order.shipping_amount ?? 0)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'order',
    entityId: id,
    summary: `Delivery charge repriced at ${chargedWeightKg} kg: ₹${quoted} quoted → ₹${charges.total} charged`,
    diff: {
      delhivery_charged_weight_kg: { from: order.delhivery_charged_weight_kg, to: chargedWeightKg },
      delhivery_billed_amount: { from: null, to: charges.total },
    },
    metadata: { awb: order.awb_number, zone: charges.zone, freight: charges.freight, tax: charges.tax },
    request,
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    chargedWeightKg,
    quoted,
    charged: charges.total,
    difference: Math.round((charges.total - quoted) * 100) / 100,
    breakdown: charges,
  })
}
