import type { Pool } from 'pg'
import { bucketFor, delta, previousPeriod, type Period } from '@/lib/overview/period'
import {
  BILLING_LINES_SQL,
  BILLING_LINE_MRR_SQL,
  BILLING_MRR_SQL,
  BILLING_PAYING_SQL,
  HAS_BILLING_SQL,
  MRR_SQL,
  NOT_PLATFORM,
  PAID_STORE_SQL,
  PAYING_SQL,
  PRICE_INR_MONTH_SQL,
  PLATFORM_TENANT_ID,
  SUBSCRIPTION_CHARGES_SQL,
  SUBSCRIPTION_CHARGE_KINDS_SQL,
  billingByKind,
  bucketSeries,
  inIst,
  istBucket,
  mrrChurnRate,
  mrrMovement,
  nextRenewal,
  num,
  periodParams,
  planMarginSql,
  platformAttention,
  round2,
  walletMix,
} from './ecom-platform'

// Platform billing overview. Recurring charges (store plan, Showcase sites, add-ons) are one Razorpay subscription
// per workspace (lib/billing): MRR is the current paying billing subscriptions, plus the plan price of a paying store
// not on one yet; "collected" is billing_charges, and settlement_ledger subscription_charge rows from before them.
// Renewals are a billing subscription's current_end (a legacy store: last charge plus one interval). New MRR is paid
// stores created in the period that went live; churned MRR is paid stores suspended or terminated in the period.
// Servers are billed at AWS price × (1 + margin), so their AWS cost is estimated at each store's plan margin
// (`margin`, the catalog's, for a store without a plan).

const WENT_LIVE = `t.status IN ('active', 'suspended', 'terminated')`
const CHURNED = `t.status IN ('suspended', 'terminated')`

export async function getEcomBillingOverview(pool: Pool, cur: Period, margin = 0.25) {
  const prev = previousPeriod(cur)
  const bucket = bucketFor(cur)
  const params = periodParams(cur, prev)

  const [mrr, plans, subs, charges, txns, wallet, series, renewals, attention, billing, lineMrr, openLines, kindRevenue, billingRenewals] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAYING_SQL}), 0)::numeric AS mrr,
              count(*) FILTER (WHERE ${PAYING_SQL})::int AS paying,
              count(*) FILTER (WHERE ${PAYING_SQL} AND t.billing_interval = 'yearly')::int AS yearly,
              COALESCE(SUM(${MRR_SQL}) FILTER (WHERE ${PAYING_SQL} AND NOT ${HAS_BILLING_SQL}), 0)::numeric AS legacy_mrr,
              count(*) FILTER (WHERE ${PAYING_SQL} AND NOT ${HAS_BILLING_SQL})::int AS legacy_paying,
              count(*) FILTER (WHERE ${PAYING_SQL} AND NOT ${HAS_BILLING_SQL} AND t.billing_interval = 'yearly')::int AS legacy_yearly,
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
      `SELECT count(*) FILTER (WHERE ${inIst('c.at', 1, 2)})::int AS n,
              COALESCE(SUM(c.amount) FILTER (WHERE ${inIst('c.at', 1, 2)}), 0)::numeric AS amount,
              COALESCE(SUM(c.refunded) FILTER (WHERE ${inIst('c.at', 1, 2)}), 0)::numeric AS refunded,
              count(*) FILTER (WHERE ${inIst('c.at', 3, 4)})::int AS n_prev,
              COALESCE(SUM(c.amount) FILTER (WHERE ${inIst('c.at', 3, 4)}), 0)::numeric AS amount_prev,
              COALESCE(SUM(c.refunded) FILTER (WHERE ${inIst('c.at', 3, 4)}), 0)::numeric AS refunded_prev
       FROM (${SUBSCRIPTION_CHARGES_SQL}) c`,
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
      `SELECT ${inIst('wl.occurred_at', 1, 2)} AS cur, wl.category, wl.entry_type, SUM(wl.amount)::numeric AS amount, count(*)::int AS n,
              COALESCE(SUM(-wl.amount / (1 + ${planMarginSql(String(Number.isFinite(margin) ? margin : 0))}))
                FILTER (WHERE wl.entry_type = 'debit' AND COALESCE(wl.category, wl.entry_type) = 'infra'), 0)::numeric AS infra_cost
       FROM wallet_ledger wl LEFT JOIN tenants t ON t.id = wl.tenant_id LEFT JOIN plans p ON p.id = t.plan_id
       WHERE wl.tenant_id <> '${PLATFORM_TENANT_ID}' AND (${inIst('wl.occurred_at', 1, 2)} OR ${inIst('wl.occurred_at', 3, 4)})
       GROUP BY 1, 2, 3`,
      params
    ),
    pool.query(
      `WITH b AS (${bucketSeries(bucket, 1, 2)}),
       x AS (SELECT ${istBucket('occurred_at', bucket)} AS b, SUM(gross_amount) AS gmv, SUM(platform_commission) AS commission
             FROM tenant_transactions WHERE status <> 'failed' AND ${inIst('occurred_at', 1, 2)} GROUP BY 1),
       s AS (SELECT ${istBucket('c.at', bucket)} AS b, SUM(c.amount) AS subs
             FROM (${SUBSCRIPTION_CHARGES_SQL}) c WHERE ${inIst('c.at', 1, 2)} GROUP BY 1),
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
              CASE WHEN t.billing_interval = 'yearly' THEN ${PRICE_INR_MONTH_SQL} * 10 ELSE ${PRICE_INR_MONTH_SQL} END::numeric AS amount,
              (SELECT max(l.occurred_at) FROM settlement_ledger l WHERE l.tenant_id = t.id AND l.entry_type = 'subscription_charge') AS last_charge
       FROM tenants t JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND ${PAYING_SQL} AND t.subscription_status IN ('active', 'authenticated') AND NOT ${HAS_BILLING_SQL}`
    ),
    platformAttention(pool, 'billing'),
    pool.query(
      `SELECT count(*) FILTER (WHERE b.status IN ${BILLING_PAYING_SQL})::int AS paying,
              count(*) FILTER (WHERE b.status IN ${BILLING_PAYING_SQL} AND b.billing_interval = 'yearly')::int AS yearly,
              COALESCE(SUM(${BILLING_MRR_SQL}) FILTER (WHERE b.status IN ${BILLING_PAYING_SQL}), 0)::numeric AS mrr,
              count(*) FILTER (WHERE b.status = 'active')::int AS active,
              count(*) FILTER (WHERE b.status = 'authenticated')::int AS authenticated,
              count(*) FILTER (WHERE b.status = 'created')::int AS created,
              count(*) FILTER (WHERE b.status = 'pending')::int AS pending,
              count(*) FILTER (WHERE b.status = 'halted')::int AS halted,
              count(*) FILTER (WHERE b.status = 'halted' AND b.grace_until > now())::int AS in_grace,
              count(*) FILTER (WHERE b.status IN ('paused', 'cancelled', 'completed', 'expired'))::int AS cancelled,
              (SELECT count(*)::int FROM billing_subscriptions r
                WHERE NOT r.is_current AND r.status = 'created' AND r.replaces_id IS NOT NULL AND r.tenant_id <> '${PLATFORM_TENANT_ID}') AS replacements
       FROM billing_subscriptions b JOIN tenants t ON t.id = b.tenant_id
       WHERE b.is_current AND ${NOT_PLATFORM}`
    ),
    pool.query(
      `SELECT e->>'kind' AS kind, COALESCE(SUM(${BILLING_LINE_MRR_SQL}), 0)::numeric AS line_mrr
       FROM billing_subscriptions b JOIN tenants t ON t.id = b.tenant_id ${BILLING_LINES_SQL}
       WHERE b.is_current AND b.status IN ${BILLING_PAYING_SQL} AND ${NOT_PLATFORM}
       GROUP BY 1`
    ),
    pool.query(
      `SELECT l.kind, l.status, count(*)::int AS n FROM billing_lines l
       WHERE l.status <> 'ended' AND l.tenant_id <> '${PLATFORM_TENANT_ID}' GROUP BY 1, 2`
    ),
    pool.query(
      `SELECT ${inIst('c.at', 1, 2)} AS cur, c.kind, COALESCE(SUM(c.amount), 0)::numeric AS kind_amount
       FROM (${SUBSCRIPTION_CHARGE_KINDS_SQL}) c
       WHERE ${inIst('c.at', 1, 2)} OR ${inIst('c.at', 3, 4)}
       GROUP BY 1, 2`,
      params
    ),
    pool.query(
      `SELECT t.id, t.display_name AS name, p.slug AS plan, b.billing_interval, b.amount_paise::numeric / 100 AS amount,
              COALESCE(b.current_end, b.start_at) AS due_at, b.lines
       FROM billing_subscriptions b JOIN tenants t ON t.id = b.tenant_id LEFT JOIN plans p ON p.id = t.plan_id
       WHERE b.is_current AND b.status IN ${BILLING_PAYING_SQL} AND ${NOT_PLATFORM}
         AND COALESCE(b.current_end, b.start_at) BETWEEN now() - interval '1 day' AND now() + interval '8 days'`
    ),
  ])

  const m = mrr.rows[0]
  const ws = billing.rows[0] ?? {}
  const legacyMrr = num(m.legacy_mrr)
  const total = round2(legacyMrr + num(ws.mrr))
  const paying = num(m.legacy_paying) + num(ws.paying)
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
    const rows = wallet.rows.filter(x => x.cur === cur)
    const w = walletMix(rows.map(x => ({ category: x.category, entry_type: x.entry_type, amount: num(x.amount), n: num(x.n) })))
    const infra_cost = round2(rows.reduce((n, x) => n + num(x.infra_cost), 0))
    return { ...w, infra_cost, infra_margin: round2(w.infra - infra_cost) }
  }

  const c = charges.rows[0]
  const kindsFor = (cur: boolean) => {
    const out: Record<string, number> = {}
    for (const r of kindRevenue.rows.filter(x => x.cur === cur)) out[r.kind] = round2((out[r.kind] ?? 0) + num(r.kind_amount))
    return out
  }
  const mrrByKind: Record<string, number> = { store_plan: legacyMrr }
  for (const r of lineMrr.rows) mrrByKind[r.kind] = round2((mrrByKind[r.kind] ?? 0) + num(r.line_mrr))
  const by_subscription = Object.fromEntries(subs.rows.map(s => [s.status, num(s.n)])) as Record<string, number>

  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const snapLines = (v: unknown): { kind?: string; label?: string }[] => (Array.isArray(v) ? v : [])
  const upcoming = [
    ...renewals.rows
      .filter(r => r.last_charge)
      .map(r => ({
        id: r.id as string,
        name: r.name as string,
        plan: r.plan as string | null,
        interval: r.billing_interval as string,
        amount: round2(num(r.amount)),
        due: nextRenewal(new Date(r.last_charge).toISOString(), r.billing_interval),
        what: null as string | null,
      })),
    ...billingRenewals.rows
      .filter(r => r.due_at)
      .map(r => ({
        id: r.id as string,
        name: r.name as string,
        plan: snapLines(r.lines).some(l => l.kind === 'store_plan') ? (r.plan as string | null) : null,
        interval: r.billing_interval as string,
        amount: round2(num(r.amount)),
        due: new Date(r.due_at).toISOString().slice(0, 10),
        what: snapLines(r.lines).map(l => l.label).filter(Boolean).join(', ') || null,
      })),
  ]
    .filter(r => r.due >= today && r.due <= horizon)
    .sort((a, b) => a.due.localeCompare(b.due))

  const current = {
    ...movement,
    churned_stores: num(m.churned),
    charges: num(c.n),
    collected: round2(num(c.amount)),
    subscription_refunds: round2(num(c.refunded)),
    by_kind: kindsFor(true),
    ...tx(true),
    wallet: walletFor(true),
  }
  const previous = {
    ...movementPrev,
    churned_stores: num(m.churned_prev),
    charges: num(c.n_prev),
    collected: round2(num(c.amount_prev)),
    subscription_refunds: round2(num(c.refunded_prev)),
    by_kind: kindsFor(false),
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
      /** Paying workspaces: on a billing subscription, or a paying store not on one yet. */
      paying,
      yearly: num(m.legacy_yearly) + num(ws.yearly),
      arpa: paying ? round2(total / paying) : null,
      mrr_churn_rate: mrrChurnRate(total, movement.new_mrr, movement.churned_mrr),
      paying_stores: num(m.paying),
      billing_mrr: round2(num(ws.mrr)),
      legacy_mrr: round2(legacyMrr),
      mrr_by_kind: mrrByKind,
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
    workspace_subscriptions: {
      active: num(ws.active),
      authenticated: num(ws.authenticated),
      created: num(ws.created),
      pending: num(ws.pending),
      halted: num(ws.halted),
      in_grace: num(ws.in_grace),
      cancelled: num(ws.cancelled),
      replacements: num(ws.replacements),
    },
    by_kind: billingByKind({
      mrr: mrrByKind,
      collected: current.by_kind,
      previous: previous.by_kind,
      lines: openLines.rows.map(r => ({ kind: r.kind, status: r.status, n: num(r.n) })),
    }),
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

export interface TenantBillingCharge {
  id: string
  paymentId: string
  invoiceId: string | null
  razorpaySubscriptionId: string | null
  interval: string | null
  amountPaise: number
  refundedPaise: number
  lines: { kind: string; label: string; amountPaise: number }[]
  periodStart: string | null
  periodEnd: string | null
  chargedAt: string
}

const isoOrNull = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

/** One page of a workspace's subscription charges (billing_charges), newest first. */
export async function getTenantBillingCharges(pool: Pick<Pool, 'query'>, tenantId: string, page: { limit: number; offset: number }) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT c.id, c.razorpay_payment_id, c.razorpay_invoice_id, c.amount_paise, c.refunded_paise, c.lines, c.period_start, c.period_end, c.charged_at,
              s.razorpay_subscription_id, s.billing_interval
       FROM billing_charges c LEFT JOIN billing_subscriptions s ON s.id = c.subscription_id
       WHERE c.tenant_id = $1 ORDER BY c.charged_at DESC, c.id LIMIT $2 OFFSET $3`,
      [tenantId, page.limit, page.offset]
    ),
    pool.query(`SELECT count(*)::int AS n FROM billing_charges WHERE tenant_id = $1`, [tenantId]),
  ])
  const charges: TenantBillingCharge[] = rows.rows.map(r => ({
    id: r.id,
    paymentId: r.razorpay_payment_id,
    invoiceId: r.razorpay_invoice_id ?? null,
    razorpaySubscriptionId: r.razorpay_subscription_id ?? null,
    interval: r.billing_interval ?? null,
    amountPaise: num(r.amount_paise),
    refundedPaise: num(r.refunded_paise),
    lines: (Array.isArray(r.lines) ? r.lines : []).map((l: any) => ({ kind: String(l?.kind ?? ''), label: String(l?.label ?? l?.kind ?? ''), amountPaise: num(l?.amountPaise) })),
    periodStart: isoOrNull(r.period_start),
    periodEnd: isoOrNull(r.period_end),
    chargedAt: isoOrNull(r.charged_at)!,
  }))
  return { rows: charges, total: num(count.rows[0]?.n) }
}
