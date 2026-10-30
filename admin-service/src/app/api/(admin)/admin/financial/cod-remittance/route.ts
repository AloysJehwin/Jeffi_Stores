import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, query } from '@/lib/shared/db'
import { generateOrderInvoice } from '@/lib/documents/invoice'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { recordCodSettlement } from '@/lib/payments/route-settlement'
import { MAX_SPAN_DAYS, bucketFor, isDate, parsePeriod, previousPeriod, spanDays, type Period } from '@/lib/overview/period'
import { fillSeries } from '@admin/app/(admin)/admin/financial/_components/overview-period'
import type { FinanceOverviewContract } from '@admin/app/(admin)/admin/financial/_components/finance-overview-contract'
import type { TrendPoint } from '@/components/admin/kit/charts'

export const dynamic = 'force-dynamic'

const IST = `'Asia/Kolkata'`
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export type CodStatus = 'cod_pending' | 'cod_collected' | 'paid'
const STATUS_KEYS: readonly CodStatus[] = ['cod_pending', 'cod_collected', 'paid']

export interface CodTotals {
  collected_count: number
  collected_amount: number
  pending_count: number
  pending_amount: number
  remitted_count: number
  remitted_amount: number
}

export interface CodByStatus {
  key: CodStatus
  count: number
  amount: number
}

export interface CodTopRow {
  id: string
  order_number: string
  customer_name: string | null
  payment_status: string
  total_amount: number
  delivered_at: string | null
  cod_remitted_at: string | null
}

export type CodOverview = Omit<FinanceOverviewContract<CodTotals, CodByStatus>, 'series' | 'top'> & {
  series: TrendPoint[]
  by_dim: CodByStatus[]
  top: CodTopRow[]
}

const inRange = (col: string) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE ${IST} AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE ${IST}`

async function codTotals(p: Period): Promise<CodTotals> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       COUNT(*) FILTER (WHERE payment_status = 'cod_collected' AND ${inRange('delivered_at')}) AS collected_count,
       COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_collected' AND ${inRange('delivered_at')}), 0) AS collected_amount,
       COUNT(*) FILTER (WHERE payment_status = 'cod_pending' AND ${inRange('created_at')}) AS pending_count,
       COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_pending' AND ${inRange('created_at')}), 0) AS pending_amount,
       COUNT(*) FILTER (WHERE payment_status = 'paid' AND ${inRange('cod_remitted_at')}) AS remitted_count,
       COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND ${inRange('cod_remitted_at')}), 0) AS remitted_amount
     FROM orders WHERE payment_mode = 'cod'`,
    [p.from, p.to]
  ).catch(() => null)
  return {
    collected_count: n(row?.collected_count),
    collected_amount: n(row?.collected_amount),
    pending_count: n(row?.pending_count),
    pending_amount: n(row?.pending_amount),
    remitted_count: n(row?.remitted_count),
    remitted_amount: n(row?.remitted_amount),
  }
}

async function codOverview(p: Period, status: CodStatus | 'all'): Promise<CodOverview> {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const [current, previous, seriesRows, topRows] = await Promise.all([
    codTotals(p),
    codTotals(prev),
    queryMany<{ b: string; k: string; v: string }>(
      `SELECT date_trunc($3::text, (delivered_at AT TIME ZONE ${IST})::date)::date::text AS b,
              'collected' AS k, COALESCE(SUM(total_amount), 0) AS v
         FROM orders
         WHERE payment_mode = 'cod' AND payment_status IN ('cod_collected', 'paid') AND ${inRange('delivered_at')}
         GROUP BY 1
       UNION ALL
       SELECT date_trunc($3::text, (cod_remitted_at AT TIME ZONE ${IST})::date)::date::text AS b,
              'remitted' AS k, COALESCE(SUM(total_amount), 0) AS v
         FROM orders
         WHERE payment_mode = 'cod' AND payment_status = 'paid' AND ${inRange('cod_remitted_at')}
         GROUP BY 1`,
      [p.from, p.to, bucket]
    ).catch(() => []),
    queryMany<CodTopRow & { total_amount: string }>(
      `SELECT id, order_number, customer_name, payment_status, total_amount, delivered_at, cod_remitted_at
       FROM orders
       WHERE payment_mode = 'cod'
         AND ($3 = 'all' OR payment_status = $3)
         AND COALESCE(cod_remitted_at, delivered_at, created_at) >= ($1::date)::timestamp AT TIME ZONE ${IST}
         AND COALESCE(cod_remitted_at, delivered_at, created_at) < ($2::date + 1)::timestamp AT TIME ZONE ${IST}
       ORDER BY COALESCE(cod_remitted_at, delivered_at, created_at) DESC
       LIMIT 50`,
      [p.from, p.to, status]
    ).catch(() => []),
  ])
  const by_dim: CodByStatus[] = [
    { key: 'cod_collected', count: current.collected_count, amount: current.collected_amount },
    { key: 'cod_pending', count: current.pending_count, amount: current.pending_amount },
    { key: 'paid', count: current.remitted_count, amount: current.remitted_amount },
  ]
  return {
    range: p,
    previous_range: prev,
    bucket,
    current,
    previous,
    series: fillSeries(p, bucket, ['collected', 'remitted'] as const, seriesRows),
    by_dim,
    top: topRows.map(r => ({
      id: r.id,
      order_number: r.order_number,
      customer_name: r.customer_name,
      payment_status: r.payment_status,
      total_amount: n(r.total_amount),
      delivered_at: r.delivered_at,
      cod_remitted_at: r.cod_remitted_at,
    })),
  }
}

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
      .query(`SELECT daily_payout FROM tenants WHERE id=$1`, [tenant.tenantId])
      .catch(() => null)
    const dailyPayout = cpRow?.rows[0]?.daily_payout === true
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
      }).catch(() => {})
    }
  }

  return NextResponse.json({ success: true, marked: remitted.rows.length })
}
