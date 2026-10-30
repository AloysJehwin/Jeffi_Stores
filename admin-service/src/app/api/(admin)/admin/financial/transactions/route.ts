import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  bucketFor,
  isDate,
  MAX_SPAN_DAYS,
  parsePeriod,
  previousPeriod,
  spanDays,
  type Bucket,
  type Period,
} from '@/lib/overview/period'

export const dynamic = 'force-dynamic'

// Finance → Transactions overview. All inflows and outflows unioned from paid orders, paid cash
// sales and expense payments, aggregated for the period (and the equal-length previous one for
// KPI deltas). Returns the FinanceOverviewContract<Totals> shape.

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

const UNION_CTE = `
  SELECT
    'outflow'::text AS direction,
    ep.payment_date::text AS txn_date,
    ep.amount::numeric AS amount,
    COALESCE(s.name, e.supplier_name, 'Supplier') AS party,
    COALESCE(ep.payment_method, 'unknown') AS method,
    'supplier'::text AS party_type,
    NULL::uuid AS user_id,
    s.id AS supplier_id,
    e.id AS expense_id
  FROM expense_payments ep
  JOIN expenses e ON e.id = ep.expense_id
  LEFT JOIN purchase_orders po ON po.id = e.po_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id

  UNION ALL

  SELECT
    'inflow'::text AS direction,
    (o.updated_at AT TIME ZONE 'UTC')::date::text AS txn_date,
    o.total_amount::numeric AS amount,
    COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), o.customer_name, 'Customer') AS party,
    COALESCE(NULLIF(o.payment_mode, ''), 'online') AS method,
    (CASE WHEN o.user_id IS NOT NULL THEN 'customer' ELSE 'order' END)::text AS party_type,
    o.user_id,
    NULL::uuid AS supplier_id,
    NULL::uuid AS expense_id
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  WHERE o.payment_status = 'paid'

  UNION ALL

  SELECT
    'inflow'::text AS direction,
    (cs.created_at AT TIME ZONE 'UTC')::date::text AS txn_date,
    cs.total_amount::numeric AS amount,
    COALESCE(cs.customer_name, 'Walk-in') AS party,
    COALESCE(NULLIF(cs.payment_mode, ''), 'cash') AS method,
    'cash'::text AS party_type,
    NULL::uuid AS user_id,
    NULL::uuid AS supplier_id,
    NULL::uuid AS expense_id
  FROM cash_sales cs
  WHERE cs.payment_status = 'paid'
`

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json(
      { error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` },
      { status: 400 }
    )
  try {
    const range = parsePeriod(from, to)
    const previous_range = previousPeriod(range)
    const bucket = bucketFor(range)
    const [current, previous, series, by_method, by_party] = await Promise.all([
      totals(range),
      totals(previous_range),
      seriesForBucket(range, bucket),
      methodBreakdown(range),
      partyBreakdown(range),
    ])
    return NextResponse.json({ range, previous_range, bucket, current, previous, series, by_method, by_party })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

type Totals = { inflow: number; outflow: number; net: number; count: number }

async function totals(p: Period): Promise<Totals> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'), 0) AS inflow,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'outflow'), 0) AS outflow,
       COUNT(*) AS count
     FROM (${UNION_CTE}) t
     WHERE txn_date >= $1 AND txn_date <= $2`,
    [p.from, p.to]
  ).catch(() => null)
  const inflow = n(row?.inflow)
  const outflow = n(row?.outflow)
  return { inflow, outflow, net: inflow - outflow, count: n(row?.count) }
}

async function seriesForBucket(p: Period, bucket: Bucket) {
  const rows = await queryMany<Record<string, string>>(
    `SELECT
       date_trunc($3::text, txn_date::date)::date::text AS label,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'), 0) AS inflow,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'outflow'), 0) AS outflow
     FROM (${UNION_CTE}) t
     WHERE txn_date >= $1 AND txn_date <= $2
     GROUP BY 1 ORDER BY 1`,
    [p.from, p.to, bucket]
  ).catch(() => [])
  return rows.map(r => ({ label: r.label, inflow: n(r.inflow), outflow: n(r.outflow) }))
}

async function methodBreakdown(p: Period) {
  const rows = await queryMany<Record<string, string>>(
    `SELECT method,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'), 0) AS inflow,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'outflow'), 0) AS outflow,
       COUNT(*) AS count
     FROM (${UNION_CTE}) t
     WHERE txn_date >= $1 AND txn_date <= $2
     GROUP BY method
     ORDER BY COALESCE(SUM(amount), 0) DESC NULLS LAST`,
    [p.from, p.to]
  ).catch(() => [])
  return rows.map(r => ({
    method: r.method ?? 'unknown',
    inflow: n(r.inflow),
    outflow: n(r.outflow),
    count: n(r.count),
  }))
}

async function partyBreakdown(p: Period) {
  const rows = await queryMany<Record<string, string | null>>(
    `SELECT party,
       MIN(party_type) AS party_type,
       (ARRAY_AGG(user_id) FILTER (WHERE user_id IS NOT NULL))[1]::text AS user_id,
       (ARRAY_AGG(supplier_id) FILTER (WHERE supplier_id IS NOT NULL))[1]::text AS supplier_id,
       (ARRAY_AGG(expense_id) FILTER (WHERE expense_id IS NOT NULL))[1]::text AS expense_id,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'), 0) AS inflow,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'outflow'), 0) AS outflow,
       COUNT(*) AS count
     FROM (${UNION_CTE}) t
     WHERE txn_date >= $1 AND txn_date <= $2
     GROUP BY party
     ORDER BY SUM(amount) DESC NULLS LAST
     LIMIT 20`,
    [p.from, p.to]
  ).catch(() => [])
  return rows.map(r => ({
    party: r.party ?? 'Unknown',
    party_type: r.party_type ?? 'order',
    user_id: r.user_id,
    supplier_id: r.supplier_id,
    expense_id: r.expense_id,
    inflow: n(r.inflow),
    outflow: n(r.outflow),
    count: n(r.count),
  }))
}
