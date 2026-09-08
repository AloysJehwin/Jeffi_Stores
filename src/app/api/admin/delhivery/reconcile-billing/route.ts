import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { query } from '@/lib/db'
import { resolveTenantId } from '@/lib/tenant-context'
import { reconcileDelhiveryBilling, type BillingReconcileRow } from '@/lib/wallet'

export const dynamic = 'force-dynamic'

// Reconcile wallet debits against Delhivery's monthly billing export.
//
// The client parses the panel CSV and posts { period, rows: [{ awb, billedAmount }] }. The tenant is
// taken from the tenant context (resolveTenantId) and NEVER from the client — a tenant admin can only true up its
// own wallet. reconcileDelhiveryBilling posts one 'adjustment' per AWB for (realBilled - debited) and
// is idempotent per (awb, period). For every adjusted AWB we also stamp the platform-DB order to the
// authoritative figure so admin views show the reconciled cost.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'delhivery:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveTenantId()
  if (!tenantId) {
    return NextResponse.json({ error: 'Billing reconciliation is per-tenant; no tenant in context.' }, { status: 400 })
  }

  const body = await request.json().catch(() => null) as { period?: unknown; rows?: unknown } | null
  const period = typeof body?.period === 'string' ? body.period.trim() : ''
  if (!period) {
    return NextResponse.json({ error: 'period is required (e.g. "2026-08").' }, { status: 400 })
  }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array of { awb, billedAmount }.' }, { status: 400 })
  }

  const rows: BillingReconcileRow[] = []
  for (const raw of body.rows as unknown[]) {
    const r = raw as { awb?: unknown; billedAmount?: unknown }
    const awb = String(r?.awb ?? '').trim()
    const billedAmount = Number(r?.billedAmount)
    if (!awb || !Number.isFinite(billedAmount) || billedAmount < 0) continue
    rows.push({ awb, billedAmount })
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid { awb, billedAmount } rows found.' }, { status: 400 })
  }

  const results = await reconcileDelhiveryBilling(rows, tenantId, period)

  const billedByAwb = new Map(rows.map((r) => [r.awb, r.billedAmount]))
  for (const res of results) {
    if (res.outcome !== 'adjusted') continue
    const billed = billedByAwb.get(res.awb)
    if (billed == null) continue
    await query(
      `UPDATE orders SET
        delhivery_billed_amount = $2,
        delhivery_billed_at = NOW(),
        delhivery_extra_charge = ROUND(($2 - shipping_amount)::numeric, 2),
        updated_at = NOW()
       WHERE awb_number = $1`,
      [res.awb, billed]
    ).catch(() => {})
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({ ok: true, period, summary, results })
}
