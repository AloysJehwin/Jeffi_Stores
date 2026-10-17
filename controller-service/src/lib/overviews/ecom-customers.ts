import type { Pool } from 'pg'
import { bucketFor, delta, previousPeriod, ratio, type Period } from '@/lib/overview/period'
import {
  MRR_SQL,
  NOT_PLATFORM,
  PAYING_SQL,
  bucketSeries,
  inIst,
  istBucket,
  num,
  periodParams,
  platformAttention,
  round2,
} from './ecom-platform'

// Platform overview of tenants (the stores and API workspaces that signed up).
// Churn has no event log: a store counts as churned in the period when it is suspended or
// terminated now and its row last changed in the period.

export const TENANT_STATUSES = [
  'active',
  'pending_approval',
  'awaiting_payment',
  'provisioning',
  'suspended',
  'terminated',
  'rejected',
] as const

/** Which products a tenant uses, from service_types. */
export function productOf(serviceTypes: string[] | null | undefined): 'store' | 'services' | 'both' {
  const s = serviceTypes ?? ['store']
  const store = s.includes('store')
  const services = s.some(x => x !== 'store')
  return store && services ? 'both' : store ? 'store' : 'services'
}

export async function getEcomCustomersOverview(pool: Pool, cur: Period) {
  const prev = previousPeriod(cur)
  const bucket = bucketFor(cur)
  const params = periodParams(cur, prev)

  const [totals, statuses, plans, products, series, top, attention] = await Promise.all([
    pool.query(
      `WITH t AS (
         SELECT t.*, ${inIst('t.created_at', 1, 2)} AS cur, ${inIst('t.created_at', 3, 4)} AS prev,
                'store' = ANY(t.service_types) AS is_store
         FROM tenants t WHERE ${NOT_PLATFORM}
       )
       SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE cur)::int AS signups,
              count(*) FILTER (WHERE prev)::int AS signups_prev,
              count(*) FILTER (WHERE cur AND is_store)::int AS store_signups,
              count(*) FILTER (WHERE prev AND is_store)::int AS store_signups_prev,
              count(*) FILTER (WHERE cur AND is_store AND status IN ('active', 'suspended', 'terminated'))::int AS store_live,
              count(*) FILTER (WHERE prev AND is_store AND status IN ('active', 'suspended', 'terminated'))::int AS store_live_prev,
              count(*) FILTER (WHERE status IN ('suspended', 'terminated') AND ${inIst('updated_at', 1, 2)})::int AS churned,
              count(*) FILTER (WHERE status IN ('suspended', 'terminated') AND ${inIst('updated_at', 3, 4)})::int AS churned_prev,
              count(*) FILTER (WHERE status = 'active' AND is_store)::int AS live_stores
       FROM t`,
      params
    ),
    pool.query(`SELECT t.status, count(*)::int AS n FROM tenants t WHERE ${NOT_PLATFORM} GROUP BY 1`),
    pool.query(
      `SELECT COALESCE(p.slug, 'none') AS plan, COALESCE(p.name, 'No plan') AS name, COALESCE(p.tier, 99) AS tier,
              count(*)::int AS total,
              count(*) FILTER (WHERE t.status = 'active')::int AS active,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAYING_SQL}), 0)::numeric AS mrr
       FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND t.status NOT IN ('terminated', 'rejected')
       GROUP BY 1, 2, 3 ORDER BY 3, 1`
    ),
    pool.query(
      `SELECT t.service_types, t.status FROM tenants t WHERE ${NOT_PLATFORM} AND t.status NOT IN ('terminated', 'rejected')`
    ),
    pool.query(
      `WITH b AS (${bucketSeries(bucket, 1, 2)})
       SELECT b.b::text AS bucket,
              count(t.id)::int AS signups,
              count(t.id) FILTER (WHERE 'store' = ANY(t.service_types))::int AS store_signups
       FROM b LEFT JOIN tenants t ON ${istBucket('t.created_at', bucket)} = b.b AND ${inIst('t.created_at', 1, 2)} AND ${NOT_PLATFORM}
       GROUP BY b.b ORDER BY b.b`,
      [cur.from, cur.to]
    ),
    pool.query(
      `SELECT t.id, t.display_name AS name, t.slug, p.slug AS plan,
              COALESCE(SUM(x.gross_amount - x.refunded_amount) FILTER (WHERE ${inIst('x.occurred_at', 1, 2)}), 0)::numeric AS gmv,
              COUNT(*) FILTER (WHERE ${inIst('x.occurred_at', 1, 2)})::int AS orders,
              COALESCE(SUM(x.gross_amount - x.refunded_amount) FILTER (WHERE ${inIst('x.occurred_at', 3, 4)}), 0)::numeric AS gmv_prev
       FROM tenant_transactions x
       JOIN tenants t ON t.id = x.tenant_id
       LEFT JOIN plans p ON p.id = t.plan_id
       WHERE x.status <> 'failed' AND (${inIst('x.occurred_at', 1, 2)} OR ${inIst('x.occurred_at', 3, 4)})
       GROUP BY 1, 2, 3, 4
       HAVING SUM(x.gross_amount) FILTER (WHERE ${inIst('x.occurred_at', 1, 2)}) > 0
       ORDER BY gmv DESC LIMIT 10`,
      params
    ),
    platformAttention(pool, 'customers'),
  ])

  const r = totals.rows[0]
  const by_status = Object.fromEntries(TENANT_STATUSES.map(s => [s, 0])) as Record<string, number>
  for (const s of statuses.rows) by_status[s.status] = num(s.n)

  const by_product = { store: 0, services: 0, both: 0 }
  for (const t of products.rows) by_product[productOf(t.service_types)]++

  const current = {
    signups: num(r.signups),
    store_signups: num(r.store_signups),
    store_live: num(r.store_live),
    conversion: ratio(num(r.store_live), num(r.store_signups)),
    churned: num(r.churned),
  }
  const previous = {
    signups: num(r.signups_prev),
    store_signups: num(r.store_signups_prev),
    store_live: num(r.store_live_prev),
    conversion: ratio(num(r.store_live_prev), num(r.store_signups_prev)),
    churned: num(r.churned_prev),
  }

  return {
    range: cur,
    previous_range: prev,
    bucket,
    snapshot: { total: num(r.total), active: num(r.active), live_stores: num(r.live_stores) },
    current,
    previous,
    deltas: {
      signups: delta(current.signups, previous.signups),
      store_signups: delta(current.store_signups, previous.store_signups),
      store_live: delta(current.store_live, previous.store_live),
      churned: delta(current.churned, previous.churned),
    },
    by_status,
    by_plan: plans.rows.map(p => ({
      plan: p.plan,
      name: p.name,
      total: num(p.total),
      active: num(p.active),
      mrr: round2(num(p.mrr)),
    })),
    by_product,
    series: series.rows.map(s => ({ bucket: s.bucket, signups: num(s.signups), store_signups: num(s.store_signups) })),
    top_stores: top.rows.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      gmv: round2(num(t.gmv)),
      orders: num(t.orders),
      change: delta(num(t.gmv), num(t.gmv_prev)),
    })),
    attention,
  }
}

export type EcomCustomersOverview = Awaited<ReturnType<typeof getEcomCustomersOverview>>
