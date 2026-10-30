import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { fillSeries } from '@admin/app/(admin)/admin/financial/_components/overview-period'

// Receivables overview backing the Finance → Receivables tab. An order is a receivable while
// payment_status is unpaid or partial and status is live. Aging runs off COALESCE(invoice_date,
// created_at) against IST today. Period filters the invoice/created day; aging is still as-of now.

const IST = `'Asia/Kolkata'`
const TODAY = `(NOW() AT TIME ZONE ${IST})::date`
const INV = `COALESCE(o.invoice_date, o.created_at)`
const IN_PERIOD = `${INV} >= ($1::date::timestamp AT TIME ZONE ${IST}) AND ${INV} < (($2::date + 1)::timestamp AT TIME ZONE ${IST})`
const OPEN = `o.payment_status IN ('unpaid','partial') AND o.status NOT IN ('draft','cancelled','cancel_rejected','returned')`
const DAYS = `(${TODAY} - ${INV}::date)`
const AGE_CASE = `CASE WHEN ${DAYS} <= 30 THEN 'd0_30' WHEN ${DAYS} <= 60 THEN 'd31_60' ELSE 'd60_plus' END`

const AGING_KEYS = ['d0_30', 'd31_60', 'd60_plus'] as const
export type ReceivablesAgingKey = (typeof AGING_KEYS)[number]

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export interface ReceivableTotals {
  outstanding: number
  invoice_count: number
  overdue: number
  avg_days: number
}

export interface ReceivableAgingRow {
  key: ReceivablesAgingKey
  amount: number
  count: number
}

export interface ReceivableDebtorRow {
  user_id: string | null
  order_id: string
  customer_name: string
  customer_phone: string | null
  outstanding: number
  invoice_count: number
  oldest_days: number
}

export interface ReceivableOverdueRow {
  order_id: string
  order_number: string
  invoice_number: string | null
  customer_name: string
  user_id: string | null
  total_amount: number
  invoice_date: string
  days_outstanding: number
  aging_bucket: ReceivablesAgingKey
  payment_status: string
}

async function totals(p: Period): Promise<ReceivableTotals> {
  const row = await queryOne<Record<string, string>>(
    `SELECT COUNT(*) AS invoice_count,
       COALESCE(SUM(o.total_amount), 0) AS outstanding,
       COALESCE(SUM(o.total_amount) FILTER (WHERE ${DAYS} > 60), 0) AS overdue,
       COALESCE(AVG(${DAYS}), 0) AS avg_days
     FROM orders o WHERE ${OPEN} AND ${IN_PERIOD}`,
    [p.from, p.to]
  ).catch(() => null)
  return {
    outstanding: n(row?.outstanding),
    invoice_count: n(row?.invoice_count),
    overdue: n(row?.overdue),
    avg_days: Math.round(n(row?.avg_days)),
  }
}

async function byAging(p: Period): Promise<ReceivableAgingRow[]> {
  const rows = await queryMany<Record<string, string>>(
    `SELECT ${AGE_CASE} AS key, COUNT(*) AS count, COALESCE(SUM(o.total_amount), 0) AS amount
     FROM orders o WHERE ${OPEN} AND ${IN_PERIOD} GROUP BY 1`,
    [p.from, p.to]
  ).catch(() => [])
  const map = new Map(rows.map(r => [r.key, { count: n(r.count), amount: n(r.amount) }]))
  return AGING_KEYS.map(k => ({ key: k, ...(map.get(k) ?? { count: 0, amount: 0 }) }))
}

async function topDebtors(p: Period): Promise<ReceivableDebtorRow[]> {
  const rows = await queryMany<Record<string, string | number | null>>(
    `SELECT MIN(o.user_id::text) AS user_id,
       (array_agg(o.id::text ORDER BY o.created_at DESC))[1] AS order_id,
       MIN(o.customer_name) AS customer_name,
       MIN(o.customer_phone) AS customer_phone,
       COUNT(*) AS invoice_count,
       COALESCE(SUM(o.total_amount), 0) AS outstanding,
       MAX(${DAYS}) AS oldest_days
     FROM orders o WHERE ${OPEN} AND ${IN_PERIOD}
     GROUP BY o.user_id ORDER BY outstanding DESC LIMIT 10`,
    [p.from, p.to]
  ).catch(() => [])
  return rows.map(r => ({
    user_id: (r.user_id as string | null) ?? null,
    order_id: String(r.order_id ?? ''),
    customer_name: String(r.customer_name ?? ''),
    customer_phone: (r.customer_phone as string | null) ?? null,
    outstanding: n(r.outstanding),
    invoice_count: n(r.invoice_count),
    oldest_days: n(r.oldest_days),
  }))
}

async function overdueInvoices(p: Period): Promise<ReceivableOverdueRow[]> {
  const rows = await queryMany<Record<string, string | number | null>>(
    `SELECT o.id::text AS order_id, o.order_number, o.invoice_number, o.customer_name,
       o.user_id::text AS user_id, o.total_amount,
       ${INV}::date::text AS invoice_date,
       ${DAYS} AS days_outstanding, ${AGE_CASE} AS aging_bucket, o.payment_status
     FROM orders o WHERE ${OPEN} AND ${IN_PERIOD} AND ${DAYS} > 30
     ORDER BY days_outstanding DESC LIMIT 50`,
    [p.from, p.to]
  ).catch(() => [])
  return rows.map(r => ({
    order_id: String(r.order_id ?? ''),
    order_number: String(r.order_number ?? ''),
    invoice_number: (r.invoice_number as string | null) ?? null,
    customer_name: String(r.customer_name ?? ''),
    user_id: (r.user_id as string | null) ?? null,
    total_amount: n(r.total_amount),
    invoice_date: String(r.invoice_date ?? ''),
    days_outstanding: n(r.days_outstanding),
    aging_bucket: (String(r.aging_bucket ?? 'd0_30') as ReceivablesAgingKey),
    payment_status: String(r.payment_status ?? ''),
  }))
}

export async function getReceivablesOverview(p: Period) {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const [current, previous, by_aging, top_debtors, overdue, seriesRows] = await Promise.all([
    totals(p),
    totals(prev),
    byAging(p),
    topDebtors(p),
    overdueInvoices(p),
    queryMany<{ b: string; k: string; v: string }>(
      `SELECT date_trunc($3::text, ${INV}::date)::date::text AS b, ${AGE_CASE} AS k,
         COALESCE(SUM(o.total_amount), 0) AS v
       FROM orders o WHERE ${OPEN} AND ${IN_PERIOD} GROUP BY 1, 2`,
      [p.from, p.to, bucket]
    ).catch(() => []),
  ])
  return {
    range: p,
    previous_range: prev,
    bucket,
    current,
    previous,
    series: fillSeries(p, bucket, [...AGING_KEYS], seriesRows),
    by_aging,
    top_debtors,
    overdue,
  }
}

export type ReceivablesOverview = Awaited<ReturnType<typeof getReceivablesOverview>>
