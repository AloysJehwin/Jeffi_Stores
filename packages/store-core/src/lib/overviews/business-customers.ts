import type { FilterScope } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import {
  bucketOf,
  bucketSeriesSql,
  hoursBetween,
  kpi,
  n,
  periodSql,
  plural,
  snapshot,
  type OverviewKpi,
} from './ops-kpi'

// B2B customers overview. A B2B order is one placed on the business channel (orders.source =
// 'business') or by a user with a business profile. Sales are billed value on the invoice date
// (finance's date); outstanding follows finance receivables (unpaid/partial, not cancelled).

const INACTIVE = `('cancelled', 'returned', 'draft', 'cancel_rejected')`
export const OVERDUE_DAYS = 30
const DAY = `COALESCE(o.invoice_date, o.created_at)`
/** `f`: the account filters, as `AND o.user_id IN (…)`. */
const b2bOrdersSql = (f = '') => `
  SELECT o.id, o.user_id, o.total_amount, o.payment_status, ${DAY} AS billed_at,
    COALESCE(bp.company_name, NULLIF(o.customer_name, ''), 'Customer') AS name,
    COALESCE(o.user_id::text, lower(NULLIF(o.customer_name, '')), o.id::text) AS cust_key,
    ((now() AT TIME ZONE 'Asia/Kolkata')::date - (${DAY} AT TIME ZONE 'Asia/Kolkata')::date) AS age_days
  FROM orders o
  LEFT JOIN business_profiles bp ON bp.user_id = o.user_id
  WHERE o.status NOT IN ${INACTIVE} AND (o.source = 'business' OR bp.id IS NOT NULL)${f}`

export interface B2bTotals {
  sales: number
  orders: number
  buyers: number
  collected: number
  aov: number | null
  applications: number
  approved: number
}

export function b2bTotals(o: Record<string, unknown> | undefined, a: Record<string, unknown> | undefined): B2bTotals {
  const sales = n(o?.sales)
  const orders = n(o?.orders)
  return {
    sales,
    orders,
    buyers: n(o?.buyers),
    collected: n(o?.collected),
    aov: ratio(sales, orders),
    applications: n(a?.applications),
    approved: n(a?.approved),
  }
}

export interface PendingApplication {
  user_id: string
  company_name: string
  created_at: string
}

export function b2bAttention(
  pending: PendingApplication[],
  overdue: { amount: number; count: number },
  dormant: number,
  now = new Date()
): AttentionItem[] {
  const out: AttentionItem[] = []
  if (pending.length) {
    const oldest = pending[0]
    const h = hoursBetween(oldest.created_at, now) ?? 0
    out.push({
      key: 'pending',
      severity: h > 48 ? 'critical' : 'warning',
      title: `${plural(pending.length, 'business application')} waiting for approval`,
      sub: `Oldest: ${oldest.company_name}, ${Math.floor(h / 24)} d ago`,
      href: '/admin/business/customers?tab=list&status=pending',
    })
  }
  if (overdue.count)
    out.push({
      key: 'overdue',
      severity: 'warning',
      title: `Rs ${Math.round(overdue.amount).toLocaleString('en-IN')} owed by B2B buyers for over ${OVERDUE_DAYS} days`,
      sub: plural(overdue.count, 'unpaid order'),
      href: '/admin/financial?tab=receivables',
    })
  if (dormant)
    out.push({
      key: 'dormant',
      severity: 'info',
      title: `${plural(dormant, 'approved account')} with no order yet`,
      href: '/admin/business/customers?tab=list&status=approved',
    })
  return out
}

/**
 * `scope`: the account list's filters, except its date. Orders count only for matching accounts;
 * unfiltered, every query is unchanged.
 */
export async function getB2bCustomerOverview(period: Period, now = new Date(), scope?: FilterScope) {
  const ps = periodSql(period)
  const bucket = bucketFor(period)
  const on = !!scope && !scope.empty
  const none = { sql: '', params: [] as unknown[] }
  const ids = (start: number) => (on ? scope!.inIds('o.user_id', start) : none)
  const and = (start: number) => (on ? scope!.and(start) : none)
  const op = ids(ps.params.length + 1)
  const o2 = ids(3)
  const o0 = ids(1)
  const pa = and(ps.params.length + 1)
  const a0 = and(1)
  const args0 = (p: unknown[]) => (on ? [p] : []) as [] | [unknown[]]
  // Unaliased profile queries take the alias only when filtered.
  const profiles = on ? 'business_profiles bp' : 'business_profiles'
  const [orderRows, appRows, accounts, outstanding, series, top, pending, dormant] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT CASE WHEN ${ps.cur('billed_at')} THEN 'cur' ELSE 'prev' END AS p,
              COALESCE(SUM(total_amount), 0) AS sales, COUNT(*) AS orders, COUNT(DISTINCT cust_key) AS buyers,
              COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS collected
       FROM (${b2bOrdersSql(op.sql)}) o WHERE ${ps.span('billed_at')} GROUP BY 1`,
      [...ps.params, ...op.params]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT p, COUNT(*) FILTER (WHERE kind = 'applied') AS applications, COUNT(*) FILTER (WHERE kind = 'approved') AS approved
       FROM (
         SELECT CASE WHEN ${ps.cur('created_at')} THEN 'cur' ELSE 'prev' END AS p, 'applied' AS kind FROM ${profiles} WHERE ${ps.span('created_at')}${pa.sql}
         UNION ALL
         SELECT CASE WHEN ${ps.cur('approved_at')} THEN 'cur' ELSE 'prev' END, 'approved' FROM ${profiles}
          WHERE approval_status = 'approved' AND ${ps.span('approved_at')}${pa.sql}
       ) x GROUP BY p`,
      [...ps.params, ...pa.params]
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE approval_status = 'approved') AS approved,
              COUNT(*) FILTER (WHERE approval_status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE approval_status = 'rejected') AS rejected
       FROM ${on ? `business_profiles bp WHERE TRUE${a0.sql}` : 'business_profiles'}`,
      ...args0(a0.params)
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COALESCE(SUM(total_amount), 0) AS amount, COUNT(*) AS count,
              COALESCE(SUM(total_amount) FILTER (WHERE age_days > ${OVERDUE_DAYS}), 0) AS overdue_amount,
              COUNT(*) FILTER (WHERE age_days > ${OVERDUE_DAYS}) AS overdue_count
       FROM (${b2bOrdersSql(o0.sql)}) o WHERE payment_status IN ('unpaid', 'partial')`,
      ...args0(o0.params)
    ),
    queryMany<Record<string, unknown>>(
      `WITH s AS (${bucketSeriesSql(bucket)}), o AS (${b2bOrdersSql(o2.sql)})
       SELECT s.b::text AS label, COALESCE(SUM(o.total_amount), 0) AS sales, COUNT(o.id) AS orders
       FROM s LEFT JOIN o ON ${bucketOf('o.billed_at', bucket)} = s.b AND ${ps.cur('o.billed_at')}
       GROUP BY s.b ORDER BY s.b`,
      [...ps.params.slice(0, 2), ...o2.params]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT cust_key, MIN(user_id::text) AS user_id, MIN(name) AS name,
              COALESCE(SUM(total_amount) FILTER (WHERE ${ps.cur('billed_at')}), 0) AS sales,
              COUNT(*) FILTER (WHERE ${ps.cur('billed_at')}) AS orders,
              COALESCE(SUM(total_amount) FILTER (WHERE payment_status IN ('unpaid', 'partial')), 0) AS outstanding
       FROM (${b2bOrdersSql(o2.sql)}) o
       GROUP BY cust_key
       HAVING COUNT(*) FILTER (WHERE ${ps.cur('billed_at')}) > 0
       ORDER BY sales DESC LIMIT 10`,
      [...ps.params.slice(0, 2), ...o2.params]
    ),
    queryMany<PendingApplication>(
      `SELECT user_id, company_name, created_at FROM ${profiles} WHERE approval_status = 'pending'${a0.sql} ORDER BY created_at ASC LIMIT 20`,
      ...args0(a0.params)
    ),
    queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM business_profiles bp
       WHERE bp.approval_status = 'approved'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = bp.user_id AND o.status NOT IN ${INACTIVE})${a0.sql}`,
      ...args0(a0.params)
    ),
  ])

  const current = b2bTotals(
    orderRows.find(r => r.p === 'cur'),
    appRows.find(r => r.p === 'cur')
  )
  const previous = b2bTotals(
    orderRows.find(r => r.p === 'prev'),
    appRows.find(r => r.p === 'prev')
  )
  const overdue = { amount: n(outstanding?.overdue_amount), count: n(outstanding?.overdue_count) }

  const kpis: OverviewKpi[] = [
    kpi('sales', 'B2B sales', current.sales, previous.sales, 'money'),
    kpi('orders', 'B2B orders', current.orders, previous.orders, 'count'),
    kpi('aov', 'Avg order', current.aov, previous.aov, 'money'),
    kpi('buyers', 'Active buyers', current.buyers, previous.buyers, 'count'),
    snapshot('accounts', 'Approved accounts', n(accounts?.approved), 'count', {
      sub: `${n(accounts?.pending)} pending`,
    }),
    kpi('applications', 'New applications', current.applications, previous.applications, 'count'),
    snapshot('outstanding', 'Credit outstanding', n(outstanding?.amount), 'money', {
      invert: true,
      sub: `${plural(n(outstanding?.count), 'unpaid order')}`,
    }),
    snapshot('overdue', `Over ${OVERDUE_DAYS} days`, overdue.amount, 'money', { invert: true }),
  ]

  return {
    range: period,
    previous_range: ps.previous,
    bucket,
    kpis,
    current,
    previous,
    accounts: { approved: n(accounts?.approved), pending: n(accounts?.pending), rejected: n(accounts?.rejected) },
    outstanding: {
      amount: n(outstanding?.amount),
      count: n(outstanding?.count),
      overdue_amount: overdue.amount,
      overdue_count: overdue.count,
    },
    series: series.map(s => ({ label: String(s.label), sales: n(s.sales), orders: n(s.orders) })),
    top_customers: top.map(t => ({
      key: String(t.cust_key),
      user_id: (t.user_id as string | null) ?? null,
      name: String(t.name ?? ''),
      sales: n(t.sales),
      orders: n(t.orders),
      outstanding: n(t.outstanding),
    })),
    pending: pending.slice(0, 8),
    attention: b2bAttention(pending, overdue, n(dormant?.n), now),
    filtered: on,
  }
}
