import type { Pool } from 'pg'
import { bucketFor, delta, previousPeriod, type Period } from '@/lib/overview/period'
import {
  MRR_SQL,
  NOT_PLATFORM,
  PAID_STORE_SQL,
  PAYING_SQL,
  PLATFORM_TENANT_ID,
  bucketSeries,
  inIst,
  istBucket,
  mrrChurnRate,
  mrrMovement,
  nextRenewal,
  num,
  periodParams,
  platformAttention,
  round2,
  walletMix,
} from './ecom-platform'

// Platform billing overview. Subscriptions are billed by Razorpay, so there is no invoice table:
// "collected" is settlement_ledger subscription_charge rows, "failed" is a halted subscription,
// and renewals are the last charge plus one interval. New MRR is paid stores created in the period
// that went live; churned MRR is paid stores suspended or terminated in the period.
// Servers are billed at AWS price × (1 + margin), so their AWS cost is estimated at the current margin.

const WENT_LIVE = `t.status IN ('active', 'suspended', 'terminated')`
const CHURNED = `t.status IN ('suspended', 'terminated')`

export async function getEcomBillingOverview(pool: Pool, cur: Period, margin = 0.25) {
  const prev = previousPeriod(cur)
  const bucket = bucketFor(cur)
  const params = periodParams(cur, prev)

  const [mrr, plans, subs, charges, txns, wallet, series, renewals, attention] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAYING_SQL}), 0)::numeric AS mrr,
              count(*) FILTER (WHERE ${PAYING_SQL})::int AS paying,
              count(*) FILTER (WHERE ${PAYING_SQL} AND t.billing_interval = 'yearly')::int AS yearly,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAID_STORE_SQL} AND ${WENT_LIVE} AND ${inIst('t.created_at', 1, 2)}), 0)::numeric AS new_mrr,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAID_STORE_SQL} AND ${WENT_LIVE} AND ${inIst('t.created_at', 3, 4)}), 0)::numeric AS new_mrr_prev,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAID_STORE_SQL} AND ${CHURNED} AND ${inIst('t.updated_at', 1, 2)}), 0)::numeric AS churned_mrr,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAID_STORE_SQL} AND ${CHURNED} AND ${inIst('t.updated_at', 3, 4)}), 0)::numeric AS churned_mrr_prev,
              count(*) FILTER (WHERE ${PAID_STORE_SQL} AND ${CHURNED} AND ${inIst('t.updated_at', 1, 2)})::int AS churned,
              count(*) FILTER (WHERE ${PAID_STORE_SQL} AND ${CHURNED} AND ${inIst('t.updated_at', 3, 4)})::int AS churned_prev
       FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM}`,
      params
    ),
    pool.query(
      `SELECT p.slug AS plan, p.name, p.tier, p.monthly_price_inr AS price,
              count(*)::int AS paying,
              COALESCE(SUM(${MRR_SQL}), 0)::numeric AS mrr
       FROM tenants t JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND ${PAYING_SQL}
       GROUP BY 1, 2, 3, 4 ORDER BY 3`
    ),
    pool.query(
      `SELECT t.subscription_status AS status, count(*)::int AS n
       FROM tenants t JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND ${PAID_STORE_SQL} AND t.status NOT IN ('rejected', 'terminated')
       GROUP BY 1`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE ${inIst('occurred_at', 1, 2)})::int AS n,
              COALESCE(-SUM(amount) FILTER (WHERE ${inIst('occurred_at', 1, 2)}), 0)::numeric AS amount,
              count(*) FILTER (WHERE ${inIst('occurred_at', 3, 4)})::int AS n_prev,
              COALESCE(-SUM(amount) FILTER (WHERE ${inIst('occurred_at', 3, 4)}), 0)::numeric AS amount_prev
       FROM settlement_ledger WHERE entry_type = 'subscription_charge'`,
      params
    ),
    pool.query(
      `SELECT ${inIst('occurred_at', 1, 2)} AS cur,
              COALESCE(SUM(gross_amount) FILTER (WHERE status <> 'failed'), 0)::numeric AS gmv,
              COALESCE(SUM(platform_commission) FILTER (WHERE status <> 'failed'), 0)::numeric AS commission,
              COALESCE(SUM(gateway_fee) FILTER (WHERE status <> 'failed'), 0)::numeric AS gateway_fees,
              COALESCE(SUM(refunded_amount), 0)::numeric AS refunds,
              count(*) FILTER (WHERE status <> 'failed')::int AS orders,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM tenant_transactions
       WHERE ${inIst('occurred_at', 1, 2)} OR ${inIst('occurred_at', 3, 4)}
       GROUP BY 1`,
      params
    ),
    pool.query(
      `SELECT ${inIst('occurred_at', 1, 2)} AS cur, category, entry_type, SUM(amount)::numeric AS amount, count(*)::int AS n
       FROM wallet_ledger
       WHERE tenant_id <> '${PLATFORM_TENANT_ID}' AND (${inIst('occurred_at', 1, 2)} OR ${inIst('occurred_at', 3, 4)})
       GROUP BY 1, 2, 3`,
      params
    ),
    pool.query(
      `WITH b AS (${bucketSeries(bucket, 1, 2)}),
       x AS (SELECT ${istBucket('occurred_at', bucket)} AS b, SUM(gross_amount) AS gmv, SUM(platform_commission) AS commission
             FROM tenant_transactions WHERE status <> 'failed' AND ${inIst('occurred_at', 1, 2)} GROUP BY 1),
       s AS (SELECT ${istBucket('occurred_at', bucket)} AS b, -SUM(amount) AS subs
             FROM settlement_ledger WHERE entry_type = 'subscription_charge' AND ${inIst('occurred_at', 1, 2)} GROUP BY 1),
       w AS (SELECT ${istBucket('occurred_at', bucket)} AS b, -SUM(amount) AS usage
             FROM wallet_ledger WHERE entry_type = 'debit' AND ${inIst('occurred_at', 1, 2)} GROUP BY 1)
       SELECT b.b::text AS bucket, COALESCE(x.gmv, 0)::numeric AS gmv, COALESCE(x.commission, 0)::numeric AS commission,
              COALESCE(s.subs, 0)::numeric AS subscriptions, COALESCE(w.usage, 0)::numeric AS wallet_usage
       FROM b LEFT JOIN x ON x.b = b.b LEFT JOIN s ON s.b = b.b LEFT JOIN w ON w.b = b.b
       ORDER BY b.b`,
      [cur.from, cur.to]
    ),
    pool.query(
      `SELECT t.id, t.display_name AS name, p.slug AS plan, t.billing_interval, ${MRR_SQL}::numeric AS mrr,
              CASE WHEN t.billing_interval = 'yearly' THEN p.monthly_price_inr * 10 ELSE p.monthly_price_inr END::numeric AS amount,
              (SELECT max(l.occurred_at) FROM settlement_ledger l WHERE l.tenant_id = t.id AND l.entry_type = 'subscription_charge') AS last_charge
       FROM tenants t JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND ${PAYING_SQL} AND t.subscription_status IN ('active', 'authenticated')`
    ),
    platformAttention(pool, 'billing'),
  ])

  const m = mrr.rows[0]
  const total = round2(num(m.mrr))
  const movement = mrrMovement(num(m.new_mrr), num(m.churned_mrr))
  const movementPrev = mrrMovement(num(m.new_mrr_prev), num(m.churned_mrr_prev))

  const tx = (cur: boolean) => {
    const row = txns.rows.find(x => x.cur === cur)
    return {
      gmv: round2(num(row?.gmv)),
      commission: round2(num(row?.commission)),
      gateway_fees: round2(num(row?.gateway_fees)),
      refunds: round2(num(row?.refunds)),
      orders: num(row?.orders),
      failed: num(row?.failed),
    }
  }
  const walletFor = (cur: boolean) => {
    const w = walletMix(
      wallet.rows
        .filter(x => x.cur === cur)
        .map(x => ({ category: x.category, entry_type: x.entry_type, amount: num(x.amount), n: num(x.n) }))
    )
    const infra_cost = round2(w.infra / (1 + margin))
    return { ...w, infra_cost, infra_margin: round2(w.infra - infra_cost) }
  }

  const c = charges.rows[0]
  const by_subscription = Object.fromEntries(subs.rows.map(s => [s.status, num(s.n)])) as Record<string, number>

  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const upcoming = renewals.rows
    .filter(r => r.last_charge)
    .map(r => ({
      id: r.id,
      name: r.name,
      plan: r.plan,
      interval: r.billing_interval,
      amount: round2(num(r.amount)),
      due: nextRenewal(new Date(r.last_charge).toISOString(), r.billing_interval),
    }))
    .filter(r => r.due >= today && r.due <= horizon)
    .sort((a, b) => a.due.localeCompare(b.due))

  const current = {
    ...movement,
    churned_stores: num(m.churned),
    charges: num(c.n),
    collected: round2(num(c.amount)),
    ...tx(true),
    wallet: walletFor(true),
  }
  const previous = {
    ...movementPrev,
    churned_stores: num(m.churned_prev),
    charges: num(c.n_prev),
    collected: round2(num(c.amount_prev)),
    ...tx(false),
    wallet: walletFor(false),
  }

  return {
    range: cur,
    previous_range: prev,
    bucket,
    snapshot: {
      mrr: total,
      arr: round2(total * 12),
      paying: num(m.paying),
      yearly: num(m.yearly),
      arpa: num(m.paying) ? round2(total / num(m.paying)) : null,
      mrr_churn_rate: mrrChurnRate(total, movement.new_mrr, movement.churned_mrr),
    },
    current,
    previous,
    deltas: {
      new_mrr: delta(current.new_mrr, previous.new_mrr),
      churned_mrr: delta(current.churned_mrr, previous.churned_mrr),
      collected: delta(current.collected, previous.collected),
      gmv: delta(current.gmv, previous.gmv),
      commission: delta(current.commission, previous.commission),
      topups: delta(current.wallet.topups, previous.wallet.topups),
      messaging: delta(current.wallet.messaging, previous.wallet.messaging),
      infra: delta(current.wallet.infra, previous.wallet.infra),
    },
    by_plan: plans.rows.map(p => ({
      plan: p.plan,
      name: p.name,
      price: num(p.price),
      paying: num(p.paying),
      mrr: round2(num(p.mrr)),
      arr: round2(num(p.mrr) * 12),
    })),
    subscriptions: {
      active: by_subscription.active ?? 0,
      authenticated: by_subscription.authenticated ?? 0,
      created: by_subscription.created ?? 0,
      halted: by_subscription.halted ?? 0,
      cancelled: (by_subscription.cancelled ?? 0) + (by_subscription.completed ?? 0) + (by_subscription.expired ?? 0),
    },
    renewals_7d: upcoming,
    series: series.rows.map(s => ({
      bucket: s.bucket,
      gmv: round2(num(s.gmv)),
      commission: round2(num(s.commission)),
      subscriptions: round2(num(s.subscriptions)),
      wallet_usage: round2(num(s.wallet_usage)),
    })),
    attention,
  }
}

export type EcomBillingOverview = Awaited<ReturnType<typeof getEcomBillingOverview>>
