import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { fillSeries } from './overview-period'
import type { FinanceOverviewContract } from './overview-contract'
// Same shape as the kit chart's TrendPoint (lib code may not import components).
type TrendPoint = { label: string } & Record<string, number | string>

const IST = `'Asia/Kolkata'`
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export type CodStatus = 'cod_pending' | 'cod_collected' | 'paid'
export const STATUS_KEYS: readonly CodStatus[] = ['cod_pending', 'cod_collected', 'paid']

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

export async function codTotals(p: Period): Promise<CodTotals> {
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

export async function codOverview(p: Period, status: CodStatus | 'all'): Promise<CodOverview> {
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

