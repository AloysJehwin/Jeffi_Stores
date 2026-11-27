import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, query } from '@/lib/shared/db'
import { generateOrderInvoice } from '@/lib/documents/invoice'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { recordCodSettlement } from '@/lib/payments/route-settlement'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays } from '@/lib/overview/period'
import { STATUS_KEYS, codOverview, type CodStatus } from '@/lib/finance/cod-remittance'

export type { CodStatus, CodTotals, CodByStatus, CodTopRow, CodOverview } from '@/lib/finance/cod-remittance'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json({ error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` }, { status: 400 })

  const statusRaw = sp.get('status') || 'all'
  const status: CodStatus | 'all' = (STATUS_KEYS as readonly string[]).includes(statusRaw) ? (statusRaw as CodStatus) : 'all'

  try {
    return NextResponse.json(await codOverview(parsePeriod(from, to), status))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { orderIds } = body

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
  }

  const remitted = await query<{ id: string }>(
    `UPDATE orders
     SET payment_status = 'paid', cod_remitted_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[]) AND payment_mode = 'cod' AND payment_status = 'cod_collected'
     RETURNING id`,
    [orderIds]
  )

  // Now that these COD orders are 'paid', render their invoice PDFs (the number
  // was assigned at processing; generateOrderInvoice was paid-gated until now).
  // Fire-and-forget so remittance never fails on PDF/S3 errors.
  for (const row of remitted.rows) {
    generateOrderInvoice(row.id).catch(() => {})
  }

  // For tenant stores (not the platform's own store), record a COD settlement in
  // the control-plane ledger so the tenant is credited (gross − commission − actual
  // Delhivery charge). Uses the reconciled delhivery_billed_amount when available.
  const tenant = await resolveTenant()
  if (tenant?.tenantId && remitted.rows.length > 0) {
    const { controlPlanePool } = await import('@/lib/tenant-registry')
    const cpRow = await controlPlanePool()
      .query(`SELECT daily_payout, own_delhivery FROM tenants WHERE id=$1`, [tenant.tenantId])
      .catch(() => null)
    const dailyPayout = cpRow?.rows[0]?.daily_payout === true
    // Its own Delhivery account billed the shipping directly; don't deduct it from the share.
    const ownDelhivery = cpRow?.rows[0]?.own_delhivery === true
    const settledOrders = await queryMany<{
      order_number: string
      total_amount: string
      delhivery_billed_amount: string | null
      shipping_amount: string | null
      delhivery_billed_at: string | null
    }>(
      `SELECT order_number, total_amount, delhivery_billed_amount, shipping_amount, delhivery_billed_at
       FROM orders WHERE id = ANY($1::uuid[])`,
      [remitted.rows.map(r => r.id)]
    ).catch(() => [])
    for (const o of settledOrders) {
      const actualDelhivery =
        o.delhivery_billed_amount != null ? parseFloat(o.delhivery_billed_amount) : parseFloat(o.shipping_amount ?? '0')
      // `delhivery_billed_at` is only stamped once the wallet debit is durable, so it is the
      // signal that shipping has already been charged. Deducting it here too billed the tenant
      // twice for the same AWB.
      recordCodSettlement({
        tenantId: tenant.tenantId,
        tenantSlug: tenant.slug ?? '',
        orderRef: o.order_number,
        grossAmountInr: parseFloat(o.total_amount),
        actualDelhiveryChargeInr: actualDelhivery,
        dailyPayout,
        walletBilled: o.delhivery_billed_at != null,
        ownDelhivery,
      }).catch(() => {})
    }
  }

  return NextResponse.json({ success: true, marked: remitted.rows.length })
}
