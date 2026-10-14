import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant, lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { query } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { reconcileDelhiveryBilling, type BillingReconcileRow } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

// True up a tenant's wallet against the PLATFORM Delhivery account's billing export (weight
// disputes, RTO, COD fee, re-attempt and other charge corrections). Platform admin only: the tenant
// never sees the platform's Delhivery panel, so a tenant-submitted CSV would be self-credit.
// Body: { period: "2026-08", rows: [{ awb, billedAmount }] }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { period?: unknown; rows?: unknown } | null
  const period = typeof body?.period === 'string' ? body.period.trim() : ''
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: 'period is required as YYYY-MM (e.g. "2026-08").' }, { status: 400 })
  }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array of { awb, billedAmount }.' }, { status: 400 })
  }
  const rows: BillingReconcileRow[] = []
  for (const raw of body.rows as unknown[]) {
    const r = raw as { awb?: unknown; billedAmount?: unknown }
    const awb = String(r?.awb ?? '').trim()
    const billedAmount = Number(r?.billedAmount)
    if (!awb || awb.length > 40 || !Number.isFinite(billedAmount) || billedAmount < 0) continue
    rows.push({ awb, billedAmount })
  }
  if (rows.length === 0) return NextResponse.json({ error: 'No valid { awb, billedAmount } rows found.' }, { status: 400 })

  const results = await reconcileDelhiveryBilling(rows, tenantId, period)

  // Mirror the authoritative figure onto the tenant's orders (forward AWBs only; RVP AWBs live on
  // return_requests and are tracked in the ledger alone).
  const ctx = await lookupTenantContextById(tenantId).catch(() => null)
  if (ctx) {
    const billedByAwb = new Map(rows.map(r => [r.awb, r.billedAmount]))
    await runWithTenantContext(ctx, async () => {
      for (const res of results) {
        if (res.outcome !== 'adjusted') continue
        await query(
          `UPDATE orders SET
            delhivery_billed_amount = $2,
            delhivery_billed_at = COALESCE(delhivery_billed_at, NOW()),
            delhivery_extra_charge = ROUND(($2 - COALESCE(shipping_amount, 0))::numeric, 2),
            updated_at = NOW()
           WHERE awb_number = $1`,
          [res.awb, billedByAwb.get(res.awb)]
        ).catch(() => {})
      }
    }).catch(() => {})
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
    return acc
  }, {})

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'tenant',
    entityId: tenantId,
    summary: `Delhivery billing reconciled for ${tenant.slug} (${period}): ${JSON.stringify(summary)}`,
    metadata: { tenantId, period, summary, source: 'platform-admin' },
    request,
  }).catch(() => {})

  return NextResponse.json({ ok: true, period, summary, results })
}
