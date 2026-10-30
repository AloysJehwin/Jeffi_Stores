import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Bucket, type Period } from '@/lib/overview/period'
import { fillSeries } from '@controller/app/(admin)/admin/financial/_components/overview-period'
import { getCashflow, type CashflowMonth } from '@/lib/payments/financial'

// Cashflow overview matching FinanceOverviewContract. Current + previous period totals, bucketed
// trend (cash_in/cash_out/net), by-source and by-destination mix rows, and the monthly rollup
// for the drill-down table. Writes (payables/wallet) are untouched.

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export interface CashflowTotals {
  cash_in: number
  cash_out: number
  net: number
  opening_balance: number
  closing_balance: number
}

export interface CashflowDimRow {
  key: string
  label: string
  amount: number
}

const SOURCE_LABELS: Record<string, string> = {
  online: 'Online',
  business: 'Business',
  cash_sale: 'Cash sale',
  offline: 'Offline',
}

type PeriodTotals = {
  cash_in: number
  cash_out: number
  po_payments: number
  refunds_out: number
  by_source: CashflowDimRow[]
}

async function periodTotals(p: Period): Promise<PeriodTotals> {
  const toTs = p.to + ' 23:59:59'
  const [inRows, poRow, refRow] = await Promise.all([
    queryMany<{ source: string; amount: string }>(
      `SELECT o.source AS source, COALESCE(SUM(o.total_amount), 0) AS amount
       FROM orders o
       WHERE o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
         AND COALESCE(o.invoice_date, o.created_at) >= $1
         AND COALESCE(o.invoice_date, o.created_at) <= $2
       GROUP BY 1
       UNION ALL
       SELECT 'cash_sale' AS source, COALESCE(SUM(cs.total_amount), 0) AS amount
       FROM cash_sales cs
       WHERE cs.payment_status = 'paid'
         AND cs.created_at >= $1 AND cs.created_at <= $2`,
      [p.from, toTs]
    ).catch(() => [] as { source: string; amount: string }[]),
    queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS v
       FROM expense_payments
       WHERE payment_date >= $1::date AND payment_date <= $2::date`,
      [p.from, p.to]
    ).catch(() => null),
    queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS v
       FROM orders
       WHERE status IN ('cancelled', 'returned')
         AND payment_status = 'paid'
         AND updated_at >= $1 AND updated_at <= $2`,
      [p.from, toTs]
    ).catch(() => null),
  ])

  const bySrc: Record<string, number> = { online: 0, business: 0, cash_sale: 0, offline: 0 }
  for (const r of inRows) {
    const key = r.source === 'online' || r.source === 'business' || r.source === 'cash_sale' ? r.source : 'offline'
    bySrc[key] += n(r.amount)
  }
  const cash_in = Object.values(bySrc).reduce((a, b) => a + b, 0)
  const po_payments = n(poRow?.v)
  const refunds_out = n(refRow?.v)
  const cash_out = po_payments + refunds_out

  const by_source: CashflowDimRow[] = Object.entries(bySrc)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: SOURCE_LABELS[k] ?? k, amount: v }))
    .sort((a, b) => b.amount - a.amount)

  return { cash_in, cash_out, po_payments, refunds_out, by_source }
}

async function openingBalance(from: string): Promise<number> {
  const row = await queryOne<{ v: string }>(
    `SELECT (
       COALESCE((SELECT SUM(total_amount) FROM orders
         WHERE payment_status = 'paid'
           AND status NOT IN ('cancelled','returned','draft','cancel_rejected')
           AND COALESCE(invoice_date, created_at) < $1), 0)
       + COALESCE((SELECT SUM(total_amount) FROM cash_sales
           WHERE payment_status = 'paid' AND created_at < $1), 0)
       - COALESCE((SELECT SUM(amount) FROM expense_payments
           WHERE payment_date < $1::date), 0)
       - COALESCE((SELECT SUM(total_amount) FROM orders
           WHERE status IN ('cancelled','returned')
             AND payment_status = 'paid'
             AND updated_at < $1), 0)
     ) AS v`,
    [from]
  ).catch(() => null)
  return n(row?.v)
}

type SeriesRow = { b: string; k: 'cash_in' | 'cash_out'; v: number }

async function bucketedSeries(p: Period, bucket: Bucket): Promise<SeriesRow[]> {
  const toTs = p.to + ' 23:59:59'
  const [ordIn, saleIn, poOut, refOut] = await Promise.all([
    queryMany<{ b: string; v: string }>(
      `SELECT date_trunc($3::text, (COALESCE(invoice_date, created_at))::date)::date::text AS b,
         COALESCE(SUM(total_amount), 0) AS v
       FROM orders
       WHERE payment_status = 'paid'
         AND status NOT IN ('cancelled','returned','draft','cancel_rejected')
         AND COALESCE(invoice_date, created_at) >= $1
         AND COALESCE(invoice_date, created_at) <= $2
       GROUP BY 1`,
      [p.from, toTs, bucket]
    ).catch(() => [] as { b: string; v: string }[]),
    queryMany<{ b: string; v: string }>(
      `SELECT date_trunc($3::text, created_at::date)::date::text AS b,
         COALESCE(SUM(total_amount), 0) AS v
       FROM cash_sales
       WHERE payment_status = 'paid' AND created_at >= $1 AND created_at <= $2
       GROUP BY 1`,
      [p.from, toTs, bucket]
    ).catch(() => [] as { b: string; v: string }[]),
    queryMany<{ b: string; v: string }>(
      `SELECT date_trunc($3::text, payment_date)::date::text AS b,
         COALESCE(SUM(amount), 0) AS v
       FROM expense_payments
       WHERE payment_date >= $1::date AND payment_date <= $2::date
       GROUP BY 1`,
      [p.from, p.to, bucket]
    ).catch(() => [] as { b: string; v: string }[]),
    queryMany<{ b: string; v: string }>(
      `SELECT date_trunc($3::text, updated_at::date)::date::text AS b,
         COALESCE(SUM(total_amount), 0) AS v
       FROM orders
       WHERE status IN ('cancelled','returned')
         AND payment_status = 'paid'
         AND updated_at >= $1 AND updated_at <= $2
       GROUP BY 1`,
      [p.from, toTs, bucket]
    ).catch(() => [] as { b: string; v: string }[]),
  ])

  const flat: SeriesRow[] = []
  for (const r of ordIn) flat.push({ b: r.b, k: 'cash_in', v: n(r.v) })
  for (const r of saleIn) flat.push({ b: r.b, k: 'cash_in', v: n(r.v) })
  for (const r of poOut) flat.push({ b: r.b, k: 'cash_out', v: n(r.v) })
  for (const r of refOut) flat.push({ b: r.b, k: 'cash_out', v: n(r.v) })
  return flat
}

export async function getCashflowOverview(p: Period) {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const [cur, prv, opening, rawSeries, monthly] = await Promise.all([
    periodTotals(p),
    periodTotals(prev),
    openingBalance(p.from),
    bucketedSeries(p, bucket),
    getCashflow(p.from, p.to).then(r => r.monthly as CashflowMonth[]).catch(() => [] as CashflowMonth[]),
  ])

  const current: CashflowTotals = {
    cash_in: cur.cash_in,
    cash_out: cur.cash_out,
    net: cur.cash_in - cur.cash_out,
    opening_balance: opening,
    closing_balance: opening + (cur.cash_in - cur.cash_out),
  }
  const previous: CashflowTotals = {
    cash_in: prv.cash_in,
    cash_out: prv.cash_out,
    net: prv.cash_in - prv.cash_out,
    opening_balance: 0,
    closing_balance: 0,
  }

  // Fill buckets for cash_in / cash_out, then derive net per bucket.
  const filled = fillSeries(p, bucket, ['cash_in', 'cash_out'] as const, rawSeries)
  const series = filled.map(pt => ({ ...pt, net: pt.cash_in - pt.cash_out }))

  const by_dim = cur.by_source
  const by_dim2: CashflowDimRow[] = [
    { key: 'po_payments', label: 'Supplier payments', amount: cur.po_payments },
    { key: 'refunds_out', label: 'Refunds', amount: cur.refunds_out },
  ].filter(r => r.amount > 0)

  return {
    range: p,
    previous_range: prev,
    bucket,
    current,
    previous,
    series,
    by_dim,
    by_dim2,
    monthly,
  }
}

export type CashflowOverview = Awaited<ReturnType<typeof getCashflowOverview>>
