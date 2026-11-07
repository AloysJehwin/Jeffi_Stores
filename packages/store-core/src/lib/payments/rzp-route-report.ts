import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { resolvePayoutTarget } from './route-settlement'

/**
 * What a Route store's Financial → Settlements tab reads. Its online payments are collected on the
 * platform account; each payment's share is transferred to the store's linked account (held until its
 * payout day) and Razorpay pays the linked account out to the store's bank. COD is left out: that cash
 * comes through the Delhivery remittance.
 */

const IST = `'Asia/Kolkata'`
const n = (v: unknown) => Number(v) || 0
const inPeriod = (col: string) => `(${col} AT TIME ZONE ${IST})::date BETWEEN $2::date AND $3::date`
// Legacy rows kept the trf_ only in gateway_txn_id (transferIdOf).
const STAGE = `CASE WHEN status = 'failed' THEN 'failed'
  WHEN COALESCE(transfer_id, CASE WHEN gateway_txn_id LIKE 'trf\\_%' THEN gateway_txn_id END) IS NULL THEN 'awaiting'
  ELSE 'on_hold' END`
const UNPAID = `tenant_id = $1 AND NOT is_cod AND recipient_settlement_id IS NULL AND status IN ('captured', 'split', 'partially_refunded', 'failed')`

export interface RoutePayoutRow {
  id: string
  settled_at: string | null
  amount: number
  fees: number
  tax: number
  utr: string | null
  status: string | null
  payments: number
}

export interface RoutePendingRow {
  id: string
  payment_id: string | null
  order_ref: string | null
  occurred_at: string
  gross: number
  share: number
  /** awaiting: not transferred yet; on_hold: with the store's linked account until its payout; failed: the transfer failed. */
  stage: 'awaiting' | 'on_hold' | 'failed'
  failure_reason: string | null
}

export interface RouteOverview {
  account: 'route'
  payoutTarget: { linked: boolean; active: boolean; dailyPayout: boolean }
  /** Payments captured in the period. */
  totals: { gross: number; commission: number; fees: number; share: number; refunded: number; payments: number }
  /** Payouts to the bank in the period. */
  paidOut: { amount: number; fees: number; count: number }
  /** Now, whatever the period: shares not yet paid out. */
  pending: { awaitingTransfer: number; onHold: number; failed: number; count: number }
  payouts: RoutePayoutRow[]
  pendingRows: RoutePendingRow[]
}

export async function routeOverview(tenantId: string, from: string, to: string): Promise<RouteOverview> {
  const pool = controlPlanePool()
  const [totals, payouts, pending, rows, target] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(gross_amount), 0) AS gross, COALESCE(SUM(platform_commission), 0) AS commission,
              COALESCE(SUM(gateway_fee), 0) AS fees, COALESCE(SUM(tenant_share), 0) AS share,
              COALESCE(SUM(refunded_amount), 0) AS refunded, COUNT(*)::int AS payments
         FROM tenant_transactions
        WHERE tenant_id = $1 AND NOT is_cod AND status <> 'failed' AND ${inPeriod('occurred_at')}`,
      [tenantId, from, to]
    ),
    pool.query(
      `SELECT s.id, s.settled_at, s.amount, s.fees, s.tax, s.utr, s.status,
              (SELECT COUNT(*) FROM tenant_transactions t WHERE t.tenant_id = s.tenant_id AND t.recipient_settlement_id = s.id)::int AS payments
         FROM linked_account_settlements s
        WHERE s.tenant_id = $1 AND ${inPeriod('s.settled_at')}
        ORDER BY s.settled_at DESC LIMIT 100`,
      [tenantId, from, to]
    ),
    pool.query(
      `SELECT COALESCE(SUM(tenant_share - reversed_amount) FILTER (WHERE stage = 'awaiting'), 0) AS awaiting,
              COALESCE(SUM(tenant_share - reversed_amount) FILTER (WHERE stage = 'on_hold'), 0) AS on_hold,
              COUNT(*) FILTER (WHERE stage = 'failed')::int AS failed, COUNT(*)::int AS count
         FROM (SELECT tenant_share, reversed_amount, ${STAGE} AS stage FROM tenant_transactions WHERE ${UNPAID}) u`,
      [tenantId]
    ),
    pool.query(
      `SELECT id, payment_id, order_ref, occurred_at, gross_amount AS gross, tenant_share - reversed_amount AS share,
              ${STAGE} AS stage, failure_reason
         FROM tenant_transactions WHERE ${UNPAID}
        ORDER BY occurred_at DESC LIMIT 50`,
      [tenantId]
    ),
    resolvePayoutTarget(tenantId).catch(() => null),
  ])
  const t = totals.rows[0] ?? {}
  const p = pending.rows[0] ?? {}
  const payoutRows: RoutePayoutRow[] = payouts.rows.map((r: any) => ({
    id: r.id,
    settled_at: r.settled_at,
    amount: n(r.amount),
    fees: n(r.fees),
    tax: n(r.tax),
    utr: r.utr ?? null,
    status: r.status ?? null,
    payments: n(r.payments),
  }))
  return {
    account: 'route',
    payoutTarget: { linked: !!target?.linkedAccountId, active: target?.active ?? false, dailyPayout: target?.dailyPayout ?? false },
    totals: {
      gross: n(t.gross),
      commission: n(t.commission),
      fees: n(t.fees),
      share: n(t.share),
      refunded: n(t.refunded),
      payments: n(t.payments),
    },
    paidOut: {
      amount: payoutRows.reduce((a, r) => a + r.amount, 0),
      fees: payoutRows.reduce((a, r) => a + r.fees, 0),
      count: payoutRows.length,
    },
    pending: { awaitingTransfer: n(p.awaiting), onHold: n(p.on_hold), failed: n(p.failed), count: n(p.count) },
    payouts: payoutRows,
    pendingRows: rows.rows.map((r: any) => ({
      id: r.id,
      payment_id: r.payment_id ?? null,
      order_ref: r.order_ref ?? null,
      occurred_at: r.occurred_at,
      gross: n(r.gross),
      share: n(r.share),
      stage: r.stage,
      failure_reason: r.failure_reason ?? null,
    })),
  }
}
