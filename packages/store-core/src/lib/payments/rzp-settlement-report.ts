import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { isJobRunning, lastRuns } from '@/lib/channels/sync-run'
import type { RazorpayAccountKind } from './rzp-account'

/** What the Financial → Razorpay tab and the order page read from the synced settlements. */

const IST = `'Asia/Kolkata'`
const n = (v: unknown) => Number(v) || 0

export interface SettlementRow {
  id: string
  settled_at: string | null
  amount: number
  fees: number
  tax: number
  utr: string | null
  status: string | null
  item_count: number
  lines_net: number
  mismatch: boolean
}

export interface SettlementOverview {
  account: 'platform' | 'own'
  totals: { settled: number; fees: number; tax: number; count: number; to_stores: number }
  settlements: SettlementRow[]
  sync: { running: boolean; last_at: string | null; last_status: string | null; last_error: string | null }
}

const ROW = `s.id, s.settled_at, s.amount::float AS amount, s.fees::float AS fees, s.tax::float AS tax, s.utr, s.status, s.item_count,
  (s.lines_credit - s.lines_debit)::float AS lines_net,
  (s.item_count > 0 AND ABS((s.lines_credit - s.lines_debit) - s.amount) > 1) AS mismatch`

export async function settlementOverview(kind: RazorpayAccountKind, from: string, to: string): Promise<SettlementOverview> {
  const range = `s.settled_at >= ($1::date)::timestamp AT TIME ZONE ${IST} AND s.settled_at < ($2::date + 1)::timestamp AT TIME ZONE ${IST}`
  const [t, rows, runs, running] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT COALESCE(SUM(s.amount), 0) AS settled, COALESCE(SUM(s.fees), 0) AS fees, COALESCE(SUM(s.tax), 0) AS tax, COUNT(*) AS count,
              COALESCE((SELECT SUM(i.debit) FROM razorpay_settlement_items i JOIN razorpay_settlements x ON x.id = i.settlement_id
                         WHERE i.type = 'transfer' AND ${range.replace(/s\.settled_at/g, 'x.settled_at')}), 0) AS to_stores
         FROM razorpay_settlements s WHERE ${range}`,
      [from, to]
    ),
    queryMany<SettlementRow>(`SELECT ${ROW} FROM razorpay_settlements s WHERE ${range} ORDER BY s.settled_at DESC LIMIT 500`, [from, to]),
    lastRuns('razorpay'),
    isJobRunning('razorpay_settlements'),
  ])
  const last = runs.settlements ?? runs.settlements_day
  return {
    account: kind === 'own' ? 'own' : 'platform',
    totals: { settled: n(t?.settled), fees: n(t?.fees), tax: n(t?.tax), count: n(t?.count), to_stores: n(t?.to_stores) },
    settlements: rows,
    sync: {
      running,
      last_at: last?.finished_at ?? null,
      last_status: last?.status ?? null,
      last_error: last?.errors?.[0]?.message ?? null,
    },
  }
}

export interface SettlementLine {
  entity_id: string
  type: string
  amount: number
  credit: number
  debit: number
  fee: number
  tax: number
  method: string | null
  payment_id: string | null
  order_id: string | null
  order_number: string | null
  source_tenant_slug: string | null
  source_order_ref: string | null
  description: string | null
  entity_created_at: string | null
}

export interface SettlementGroup {
  key: string
  label: string
  scope: string
  credit: number
  debit: number
  fees: number
  net: number
  lines: SettlementLine[]
}

export interface SettlementDetail {
  settlement: SettlementRow
  groups: SettlementGroup[]
}

const GROUP_LABEL: Record<string, string> = {
  order: 'Orders',
  platform_billing: 'Platform billing (wallet top-ups, plans)',
  adjustment: 'Adjustments, disputes and reversals',
  unmatched: 'Not matched',
}
const GROUP_ORDER = ['order', 'other_store', 'platform_billing', 'adjustment', 'unmatched']

export async function settlementDetail(id: string): Promise<SettlementDetail | null> {
  const s = await queryOne<SettlementRow>(`SELECT ${ROW} FROM razorpay_settlements s WHERE s.id = $1`, [id])
  if (!s) return null
  const lines = await queryMany<SettlementLine & { scope: string }>(
    `SELECT entity_id, type, amount::float AS amount, credit::float AS credit, debit::float AS debit, fee::float AS fee, tax::float AS tax,
            method, payment_id, order_id, order_number, source_tenant_slug, source_order_ref, description, entity_created_at, scope
       FROM razorpay_settlement_items WHERE settlement_id = $1 ORDER BY scope, entity_created_at LIMIT 5000`,
    [id]
  )
  const groups = new Map<string, SettlementGroup>()
  for (const l of lines) {
    const key = l.scope === 'other_store' ? `store:${l.source_tenant_slug || 'unknown'}` : l.scope
    const label = l.scope === 'other_store' ? `Store: ${l.source_tenant_slug || 'unknown'}` : GROUP_LABEL[l.scope] ?? l.scope
    const g = groups.get(key) ?? { key, label, scope: l.scope, credit: 0, debit: 0, fees: 0, net: 0, lines: [] }
    g.credit += l.credit
    g.debit += l.debit
    g.fees += l.fee
    g.net += l.credit - l.debit
    g.lines.push(l)
    groups.set(key, g)
  }
  const sorted = [...groups.values()].sort((a, b) => GROUP_ORDER.indexOf(a.scope) - GROUP_ORDER.indexOf(b.scope) || a.label.localeCompare(b.label))
  return { settlement: s, groups: sorted }
}

/** Razorpay settles card and UPI payments two working days after capture (T+2). */
export function estimatedSettlement(captured: Date): Date {
  const d = new Date(captured)
  let left = 2
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

export interface AwaitingRow {
  payment_id: string
  order_id: string
  order_number: string
  amount: number
  fee: number | null
  captured_at: string
  estimated_at: string
}

export interface AwaitingSettlement {
  total: number
  count: number
  rows: AwaitingRow[]
  stores: { slug: string; count: number; amount: number }[]
}

/** Captured in the last 30 days and not yet in a settlement. The flagship also sees other stores' sales. */
export async function awaitingSettlement(kind: RazorpayAccountKind): Promise<AwaitingSettlement> {
  const account = kind === 'own' ? 'own' : 'platform'
  const rows = await queryMany<Omit<AwaitingRow, 'estimated_at'>>(
    `SELECT p.transaction_id AS payment_id, p.order_id, o.order_number, p.amount::float AS amount, p.fee::float AS fee,
            COALESCE(p.captured_at, p.created_at) AS captured_at
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.payment_gateway = 'razorpay' AND p.status = 'completed' AND p.transaction_id LIKE 'pay\\_%'
        AND COALESCE(p.gateway_account, $1) = $1
        AND COALESCE(p.captured_at, p.created_at) > NOW() - INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM razorpay_settlement_items i WHERE i.type = 'payment' AND i.payment_id = p.transaction_id)
      ORDER BY COALESCE(p.captured_at, p.created_at) DESC
      LIMIT 500`,
    [account]
  )
  const out: AwaitingSettlement = {
    total: rows.reduce((a, r) => a + r.amount, 0),
    count: rows.length,
    rows: rows.map(r => ({ ...r, estimated_at: estimatedSettlement(new Date(r.captured_at)).toISOString() })),
    stores: [],
  }
  if (kind !== 'platform') return out

  const others = await controlPlanePool()
    .query<{ payment_id: string; slug: string; gross: string }>(
      `SELECT t.payment_id, n.slug, t.gross_amount AS gross
         FROM tenant_transactions t JOIN tenants n ON n.id = t.tenant_id
        WHERE t.gateway = 'razorpay_route' AND t.is_cod = false AND t.payment_id IS NOT NULL
          AND t.status NOT IN ('failed', 'refunded') AND t.occurred_at > NOW() - INTERVAL '30 days'
        LIMIT 5000`
    )
    .then(r => r.rows)
    .catch(() => [])
  if (!others.length) return out
  const settled = new Set(
    (
      await queryMany<{ payment_id: string }>(`SELECT payment_id FROM razorpay_settlement_items WHERE type = 'payment' AND payment_id = ANY($1)`, [
        others.map(o => o.payment_id),
      ])
    ).map(r => r.payment_id)
  )
  const byStore = new Map<string, { slug: string; count: number; amount: number }>()
  for (const o of others) {
    if (settled.has(o.payment_id)) continue
    const s = byStore.get(o.slug) ?? { slug: o.slug, count: 0, amount: 0 }
    s.count++
    s.amount += n(o.gross)
    byStore.set(o.slug, s)
  }
  out.stores = [...byStore.values()].sort((a, b) => b.amount - a.amount)
  return out
}

export interface OrderSettlement {
  payment_id: string
  settlement_id: string
  settled_at: string | null
  utr: string | null
  credit: number
  fee: number
}

/** The settlements that paid out an order's payments (a replacement's sit on the original order). */
export async function orderSettlements(orderIds: string[]): Promise<OrderSettlement[]> {
  return queryMany<OrderSettlement>(
    `SELECT i.payment_id, i.settlement_id, s.settled_at, s.utr, i.credit::float AS credit, i.fee::float AS fee
       FROM razorpay_settlement_items i JOIN razorpay_settlements s ON s.id = i.settlement_id
      WHERE i.order_id = ANY($1::uuid[]) AND i.type = 'payment'`,
    [orderIds]
  ).catch(() => [])
}
