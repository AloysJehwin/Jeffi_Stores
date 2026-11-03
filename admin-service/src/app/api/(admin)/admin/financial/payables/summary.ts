import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { fillSeries } from '@admin/app/(admin)/admin/financial/_components/overview-period'

// Payables overview: snapshot (outstanding / overdue / open bills as of p.to) + period flow
// (paid in [from..to]) + payments-by-method bucket series + aging mix + top open bills + top
// suppliers. Shape matches FinanceOverviewContract<Totals, Row>.

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export const PAY_METHODS = ['bank_transfer', 'upi', 'cash', 'cheque'] as const
export type PayMethod = (typeof PAY_METHODS)[number]

export const PAYABLES_AGING_KEYS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const
export type PayablesAgingKey = (typeof PAYABLES_AGING_KEYS)[number]

const AGING_LABEL: Record<PayablesAgingKey, string> = {
  current: 'Current',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: '90+ days',
}

export interface PayablesTotals {
  outstanding: number
  due_this_week: number
  overdue: number
  paid: number
  bills_open: number
}

export interface PayablesBill {
  id: string
  expense_number: string
  supplier_id: string | null
  supplier_name: string
  total_amount: number
  paid_amount: number
  due_date: string | null
  days_overdue: number | null
  status: string
  supplier_bank_name: string | null
  supplier_account_number: string | null
  supplier_ifsc: string | null
  supplier_upi_id: string | null
}

export interface PayablesSupplierRow {
  supplier_id: string | null
  supplier_name: string
  bills_open: number
  outstanding: number
  overdue: number
}

export interface PayablesAgingRow {
  key: PayablesAgingKey
  label: string
  value: number
}

async function totals(p: Period): Promise<PayablesTotals> {
  const [snap, paid] = await Promise.all([
    queryOne<Record<string, string>>(
      `WITH b AS (
         SELECT e.total_amount::numeric AS total_amount, e.due_date,
           COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep
             WHERE ep.expense_id = e.id AND ep.payment_date <= $1::date), 0)::numeric AS paid_amount
         FROM expenses e
         WHERE e.expense_date <= $1::date AND e.status != 'paid'
       )
       SELECT
         COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0)), 0) AS outstanding,
         COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0))
           FILTER (WHERE b.due_date IS NOT NULL AND b.due_date BETWEEN $1::date AND $1::date + 7), 0) AS due_this_week,
         COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0))
           FILTER (WHERE b.due_date < $1::date), 0) AS overdue,
         COUNT(*)::int AS bills_open
       FROM b`,
      [p.to]
    ).catch(() => null),
    queryOne<Record<string, string>>(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments
         WHERE payment_date BETWEEN $1::date AND $2::date`,
      [p.from, p.to]
    ).catch(() => null),
  ])
  return {
    outstanding: n(snap?.outstanding),
    due_this_week: n(snap?.due_this_week),
    overdue: n(snap?.overdue),
    paid: n(paid?.paid),
    bills_open: n(snap?.bills_open),
  }
}

async function agingRows(asOf: string): Promise<PayablesAgingRow[]> {
  const rows = await queryMany<Record<string, string>>(
    `WITH b AS (
       SELECT e.due_date, e.total_amount::numeric AS total_amount,
         COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep
           WHERE ep.expense_id = e.id AND ep.payment_date <= $1::date), 0)::numeric AS paid_amount
       FROM expenses e
       WHERE e.expense_date <= $1::date AND e.status != 'paid'
     )
     SELECT CASE
         WHEN b.due_date IS NULL OR b.due_date >= $1::date THEN 'current'
         WHEN ($1::date - b.due_date) <= 30 THEN 'd1_30'
         WHEN ($1::date - b.due_date) <= 60 THEN 'd31_60'
         WHEN ($1::date - b.due_date) <= 90 THEN 'd61_90'
         ELSE 'd90_plus'
       END AS key,
       COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0)), 0) AS value
     FROM b GROUP BY 1`,
    [asOf]
  ).catch(() => [])
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.key, n(r.value))
  return PAYABLES_AGING_KEYS.map(k => ({ key: k, label: AGING_LABEL[k], value: map.get(k) ?? 0 }))
}

async function openBills(asOf: string, limit = 20): Promise<PayablesBill[]> {
  const rows = await queryMany<Record<string, unknown>>(
    `SELECT e.id::text AS id, e.expense_number, e.supplier_name,
       e.total_amount::numeric AS total_amount, e.due_date::text AS due_date, e.status,
       COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep
         WHERE ep.expense_id = e.id AND ep.payment_date <= $1::date), 0)::numeric AS paid_amount,
       CASE WHEN e.due_date < $1::date THEN ($1::date - e.due_date)::int ELSE NULL END AS days_overdue,
       s.id::text AS supplier_id,
       s.bank_name AS supplier_bank_name,
       s.account_number AS supplier_account_number,
       s.ifsc AS supplier_ifsc,
       s.upi_id AS supplier_upi_id
     FROM expenses e
     LEFT JOIN purchase_orders po ON po.id = e.po_id
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE e.expense_date <= $1::date AND e.status != 'paid'
     ORDER BY e.due_date ASC NULLS LAST, e.expense_date DESC
     LIMIT ${limit}`,
    [asOf]
  ).catch(() => [])
  return rows.map(r => ({
    id: String(r.id),
    expense_number: String(r.expense_number ?? ''),
    supplier_id: r.supplier_id == null ? null : String(r.supplier_id),
    supplier_name: String(r.supplier_name ?? ''),
    total_amount: n(r.total_amount),
    paid_amount: n(r.paid_amount),
    due_date: r.due_date == null ? null : String(r.due_date),
    days_overdue: r.days_overdue == null ? null : Number(r.days_overdue),
    status: String(r.status ?? ''),
    supplier_bank_name: r.supplier_bank_name == null ? null : String(r.supplier_bank_name),
    supplier_account_number: r.supplier_account_number == null ? null : String(r.supplier_account_number),
    supplier_ifsc: r.supplier_ifsc == null ? null : String(r.supplier_ifsc),
    supplier_upi_id: r.supplier_upi_id == null ? null : String(r.supplier_upi_id),
  }))
}

async function topSuppliers(asOf: string, limit = 10): Promise<PayablesSupplierRow[]> {
  const rows = await queryMany<Record<string, unknown>>(
    `WITH b AS (
       SELECT e.id, e.supplier_name, e.total_amount::numeric AS total_amount, e.due_date,
         s.id::text AS supplier_id,
         COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep
           WHERE ep.expense_id = e.id AND ep.payment_date <= $1::date), 0)::numeric AS paid_amount
       FROM expenses e
       LEFT JOIN purchase_orders po ON po.id = e.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE e.expense_date <= $1::date AND e.status != 'paid'
     )
     SELECT b.supplier_id, b.supplier_name,
       COUNT(*)::int AS bills_open,
       COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0)), 0) AS outstanding,
       COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0))
         FILTER (WHERE b.due_date < $1::date), 0) AS overdue
     FROM b
     GROUP BY b.supplier_id, b.supplier_name
     ORDER BY outstanding DESC
     LIMIT ${limit}`,
    [asOf]
  ).catch(() => [])
  return rows.map(r => ({
    supplier_id: r.supplier_id ? String(r.supplier_id) : null,
    supplier_name: String(r.supplier_name ?? ''),
    bills_open: Number(r.bills_open ?? 0),
    outstanding: n(r.outstanding),
    overdue: n(r.overdue),
  }))
}

async function paymentsSeries(p: Period, bucket: 'day' | 'week' | 'month') {
  const rows = await queryMany<{ b: string; k: string; v: string }>(
    `SELECT date_trunc($3::text, ep.payment_date::timestamp)::date::text AS b,
       COALESCE(NULLIF(ep.payment_method, ''), 'bank_transfer') AS k,
       SUM(ep.amount) AS v
     FROM expense_payments ep
     WHERE ep.payment_date BETWEEN $1::date AND $2::date
     GROUP BY 1, 2`,
    [p.from, p.to, bucket]
  ).catch(() => [])
  return fillSeries(p, bucket, PAY_METHODS, rows)
}

export async function getPayablesOverview(p: Period) {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const [current, previous, aging, bills, suppliers, series] = await Promise.all([
    totals(p),
    totals(prev),
    agingRows(p.to),
    openBills(p.to),
    topSuppliers(p.to),
    paymentsSeries(p, bucket),
  ])
  return {
    range: p,
    previous_range: prev,
    bucket,
    current,
    previous,
    series,
    pay_methods: PAY_METHODS as readonly string[],
    by_dim: aging,
    by_dim2: suppliers,
    top: bills,
  }
}

export type PayablesOverview = Awaited<ReturnType<typeof getPayablesOverview>>
