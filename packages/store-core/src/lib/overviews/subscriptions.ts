import type { FilterScope } from '@jeffi/list-filters'
import type { Bucket, Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { filteredHref } from '@/lib/overview/filter-scope'
import { queryMany, queryOne } from '@/lib/shared/db'
import { SUBSCRIPTION_INTERVAL_LABELS, isSubscriptionInterval } from '@/lib/subscriptions/intervals'
import { BOUNDS, bucketsCte, byPeriod, inBucket, num, periodArgs, str, type Row } from './sales-documents'

// Razorpay-backed subscriptions only (source <> 'legacy'), as on the list. Cycle amount and the
// monthly normalisation are the same as getAdminSubscriptionStats (lib/queries/subscriptions.ts),
// so MRR agrees with the list header. A charge is a committed subscription_cycle_orders row;
// cycle 1 is the first charge, later cycles are renewals.

const CYCLE_PAISE = `(COALESCE(s.unit_price_paise, 0) * s.quantity + s.shipping_paise)`
const MONTHLY = `CASE s.interval WHEN 'weekly' THEN 52.0 / 12 WHEN 'quarterly' THEN 1.0 / 3 WHEN 'yearly' THEN 1.0 / 12 ELSE 1 END`
const NEW_SUB = `s.source <> 'legacy'`
export const DUE_DAYS = 7

// `NEW_SUB` is every query's subscription predicate, so the list's filters (on alias s) ride along with it.
const subscriptionSql = (NEW_SUB: string) => {
  // Signed up and authorised (a 'created' row is an abandoned checkout).
  const STARTED = `${NEW_SUB} AND s.status <> 'created'`
  return {
    kpis: `WITH ${BOUNDS}, per AS (
      SELECT 'cur' AS period, b.c0 AS s0, b.c1 AS s1 FROM b
      UNION ALL SELECT 'prev', b.p0, b.c0 FROM b
    )
    SELECT per.period,
           (SELECT COUNT(*) FROM subscriptions s WHERE ${STARTED} AND s.created_at >= per.s0 AND s.created_at < per.s1) AS new_subs,
           (SELECT COALESCE(SUM(${CYCLE_PAISE} * ${MONTHLY}), 0) FROM subscriptions s
             WHERE ${STARTED} AND s.created_at >= per.s0 AND s.created_at < per.s1) AS new_mrr_paise,
           (SELECT COUNT(*) FROM subscriptions s WHERE ${NEW_SUB} AND s.cancelled_at >= per.s0 AND s.cancelled_at < per.s1) AS cancelled,
           (SELECT COALESCE(SUM(${CYCLE_PAISE} * ${MONTHLY}), 0) FROM subscriptions s
             WHERE ${NEW_SUB} AND s.cancelled_at >= per.s0 AND s.cancelled_at < per.s1) AS churned_mrr_paise,
           (SELECT COUNT(*) FROM subscriptions s
             WHERE ${STARTED} AND s.created_at < per.s0 AND (s.cancelled_at IS NULL OR s.cancelled_at >= per.s0)) AS base,
           (SELECT COUNT(*) FROM subscription_cycle_orders c JOIN subscriptions s ON s.id = c.subscription_id
             WHERE ${NEW_SUB} AND c.status = 'committed' AND c.cycle_number > 1 AND c.created_at >= per.s0 AND c.created_at < per.s1) AS renewals,
           (SELECT COUNT(*) FROM subscription_cycle_orders c JOIN subscriptions s ON s.id = c.subscription_id
             WHERE ${NEW_SUB} AND c.status = 'committed' AND c.created_at >= per.s0 AND c.created_at < per.s1) AS charges,
           (SELECT COALESCE(SUM(c.amount_paise), 0) FROM subscription_cycle_orders c JOIN subscriptions s ON s.id = c.subscription_id
             WHERE ${NEW_SUB} AND c.status = 'committed' AND c.created_at >= per.s0 AND c.created_at < per.s1) AS billed_paise
      FROM per`,
    snapshot: `SELECT
      COUNT(*) FILTER (WHERE s.status = 'pending') AS retrying,
      COUNT(*) FILTER (WHERE s.status = 'halted') AS halted,
      COUNT(*) FILTER (WHERE s.status = 'created' AND s.created_at < now() - INTERVAL '1 day') AS abandoned,
      COUNT(*) FILTER (WHERE s.status = 'active' AND s.cancel_at_cycle_end) AS ending,
      COUNT(*) FILTER (WHERE s.status = 'active' AND NOT s.cancel_at_cycle_end
                         AND COALESCE(s.current_end, s.next_renewal_at) >= now()
                         AND COALESCE(s.current_end, s.next_renewal_at) < now() + INTERVAL '${DUE_DAYS} days') AS due,
      COALESCE(SUM(${CYCLE_PAISE}) FILTER (WHERE s.status = 'active' AND NOT s.cancel_at_cycle_end
                         AND COALESCE(s.current_end, s.next_renewal_at) >= now()
                         AND COALESCE(s.current_end, s.next_renewal_at) < now() + INTERVAL '${DUE_DAYS} days'), 0) AS due_paise
    FROM subscriptions s WHERE ${NEW_SUB}`,
    dueSoon: `SELECT s.id, s.status, COALESCE(s.current_end, s.next_renewal_at) AS due_at, ${CYCLE_PAISE} AS cycle_paise,
           p.name AS product, COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, 'Customer') AS customer
      FROM subscriptions s JOIN products p ON p.id = s.product_id JOIN users u ON u.id = s.user_id
     WHERE ${NEW_SUB} AND s.status = 'active' AND NOT s.cancel_at_cycle_end
       AND COALESCE(s.current_end, s.next_renewal_at) >= now()
       AND COALESCE(s.current_end, s.next_renewal_at) < now() + INTERVAL '${DUE_DAYS} days'
     ORDER BY due_at LIMIT 8`,
    failing: `SELECT s.id, s.status, s.updated_at, ${CYCLE_PAISE} AS cycle_paise,
           p.name AS product, COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, 'Customer') AS customer
      FROM subscriptions s JOIN products p ON p.id = s.product_id JOIN users u ON u.id = s.user_id
     WHERE ${NEW_SUB} AND s.status IN ('halted', 'pending')
     ORDER BY s.updated_at DESC LIMIT 8`,
    byProduct: `SELECT p.id, p.name, COUNT(*) AS active, COALESCE(SUM(${CYCLE_PAISE} * ${MONTHLY}), 0) AS mrr_paise
      FROM subscriptions s JOIN products p ON p.id = s.product_id
     WHERE ${NEW_SUB} AND s.status = 'active'
     GROUP BY p.id ORDER BY mrr_paise DESC LIMIT 8`,
    byInterval: `SELECT s.interval, COUNT(*) AS active, COALESCE(SUM(${CYCLE_PAISE} * ${MONTHLY}), 0) AS mrr_paise
      FROM subscriptions s WHERE ${NEW_SUB} AND s.status = 'active'
     GROUP BY s.interval ORDER BY mrr_paise DESC`,
    series: (bucket: Bucket) => `WITH ${BOUNDS}, ${bucketsCte(bucket)}
    SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
           (SELECT COUNT(*) FROM subscriptions s
             WHERE ${STARTED} AND s.created_at >= b.c0 AND s.created_at < b.c1 AND ${inBucket('s.created_at', bucket)}) AS new_subs,
           (SELECT COUNT(*) FROM subscriptions s
             WHERE ${NEW_SUB} AND s.cancelled_at >= b.c0 AND s.cancelled_at < b.c1 AND ${inBucket('s.cancelled_at', bucket)}) AS cancelled,
           (SELECT COALESCE(SUM(c.amount_paise), 0) FROM subscription_cycle_orders c JOIN subscriptions s ON s.id = c.subscription_id
             WHERE ${NEW_SUB} AND c.status = 'committed' AND c.created_at >= b.c0 AND c.created_at < b.c1
               AND ${inBucket('c.created_at', bucket)}) AS billed_paise
      FROM k CROSS JOIN b ORDER BY k.bucket`,
  }
}

export const SUBSCRIPTION_SQL = subscriptionSql(NEW_SUB)

const rupees = (paise: unknown) => Math.round(num(paise)) / 100

export interface SubscriptionPeriodStats {
  newSubs: number
  newMrr: number
  cancelled: number
  churnedMrr: number
  base: number
  churnRate: number | null
  renewals: number
  charges: number
  billed: number
  netNew: number
}

export function subscriptionStats(r: Row | undefined): SubscriptionPeriodStats {
  const newSubs = num(r?.new_subs)
  const cancelled = num(r?.cancelled)
  const base = num(r?.base)
  return {
    newSubs,
    newMrr: rupees(r?.new_mrr_paise),
    cancelled,
    churnedMrr: rupees(r?.churned_mrr_paise),
    base,
    churnRate: base ? cancelled / base : null,
    renewals: num(r?.renewals),
    charges: num(r?.charges),
    billed: rupees(r?.billed_paise),
    netNew: newSubs - cancelled,
  }
}

export const intervalName = (i: string | null) =>
  isSubscriptionInterval(i) ? SUBSCRIPTION_INTERVAL_LABELS[i] : i || 'Other'

export function subscriptionAttention(
  s: {
    halted: number
    retrying: number
    due: number
    dueAmount: number
    ending: number
    abandoned: number
  },
  query = ''
): AttentionItem[] {
  const out: AttentionItem[] = []
  const list = (status: string) => filteredHref('/admin/subscriptions', { tab: 'list', status }, query)
  if (s.halted)
    out.push({
      key: 'halted',
      severity: 'critical',
      title: `${s.halted} subscription${s.halted === 1 ? '' : 's'} halted after failed renewals`,
      sub: 'Razorpay stopped retrying; the customer must update the mandate',
      href: list('halted'),
    })
  if (s.retrying)
    out.push({
      key: 'retrying',
      severity: 'warning',
      title: `${s.retrying} renewal${s.retrying === 1 ? '' : 's'} failed and retrying`,
      href: list('pending'),
    })
  if (s.due)
    out.push({
      key: 'due',
      severity: 'info',
      title: `${s.due} renewal${s.due === 1 ? '' : 's'} due in the next ${DUE_DAYS} days`,
      sub: `₹${Math.round(s.dueAmount).toLocaleString('en-IN')} expected; check stock for physical items`,
      href: list('active'),
    })
  if (s.ending)
    out.push({
      key: 'ending',
      severity: 'info',
      title: `${s.ending} active subscription${s.ending === 1 ? '' : 's'} set to cancel at cycle end`,
      href: list('active'),
    })
  if (s.abandoned)
    out.push({
      key: 'abandoned',
      severity: 'info',
      title: `${s.abandoned} checkout${s.abandoned === 1 ? '' : 's'} started but never authorised`,
      href: list('created'),
    })
  return out
}

const subRow = (r: Row) => ({
  id: str(r.id),
  status: str(r.status),
  customer: str(r.customer),
  product: str(r.product),
  amount: rupees(r.cycle_paise),
  href: `/admin/subscriptions/${str(r.id)}/view`,
})

/** `scope`: the list's filters (without its start date: the period owns from/to). */
export async function loadSubscriptionOverview(
  period: Period,
  headline: { active: number; paused: number; halted: number; cancelled: number; mrr: number },
  scope?: FilterScope,
  query = ''
) {
  const { previous, bucket, args } = periodArgs(period)
  const sa = scope?.and(args.length + 1) ?? { sql: '', params: [] }
  const s1 = scope?.and(1) ?? { sql: '', params: [] }
  const withArgs = sa.sql ? subscriptionSql(`${NEW_SUB}${sa.sql}`) : SUBSCRIPTION_SQL
  const own = s1.sql ? subscriptionSql(`${NEW_SUB}${s1.sql}`) : SUBSCRIPTION_SQL
  const [kpiRows, snap, due, failing, products, intervals, series] = await Promise.all([
    queryMany<Row>(withArgs.kpis, [...args, ...sa.params]),
    queryOne<Row>(own.snapshot, s1.params),
    queryMany<Row>(own.dueSoon, s1.params),
    queryMany<Row>(own.failing, s1.params),
    queryMany<Row>(own.byProduct, s1.params),
    queryMany<Row>(own.byInterval, s1.params),
    queryMany<Row>(withArgs.series(bucket), [...args, ...sa.params]),
  ])
  const snapshot = {
    ...headline,
    arr: headline.mrr * 12,
    retrying: num(snap?.retrying),
    abandoned: num(snap?.abandoned),
    ending: num(snap?.ending),
    due: num(snap?.due),
    dueAmount: rupees(snap?.due_paise),
  }
  return {
    period,
    previous,
    bucket,
    snapshot,
    kpis: byPeriod(kpiRows, subscriptionStats),
    dueSoon: due.map(r => ({ ...subRow(r), dueAt: r.due_at })),
    failing: failing.map(r => ({ ...subRow(r), updatedAt: r.updated_at })),
    byProduct: products.map(r => ({
      id: str(r.id),
      name: str(r.name),
      active: num(r.active),
      mrr: rupees(r.mrr_paise),
    })),
    byInterval: intervals.map(r => ({
      interval: r.interval == null ? null : str(r.interval),
      label: intervalName(r.interval as string | null),
      active: num(r.active),
      mrr: rupees(r.mrr_paise),
    })),
    series: series.map(r => ({
      label: str(r.label),
      newSubs: num(r.new_subs),
      cancelled: num(r.cancelled),
      billed: rupees(r.billed_paise),
    })),
    attention: subscriptionAttention({ ...snapshot, halted: headline.halted }, query),
  }
}

export type SubscriptionOverview = Awaited<ReturnType<typeof loadSubscriptionOverview>>
