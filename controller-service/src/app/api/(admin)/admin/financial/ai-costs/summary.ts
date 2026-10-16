import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { fillSeries } from '@/app/(admin)/admin/financial/_components/overview-period'

// AI usage for Finance (tenant DB ai_usage, written by lib/ai/billing). On the flagship the
// headline amount is the platform cost; on a tenant it is what was charged to the wallet.

const IST = `'Asia/Kolkata'`
const inPeriod = `created_at >= ($1::date::timestamp AT TIME ZONE ${IST}) AND created_at < (($2::date + 1)::timestamp AT TIME ZONE ${IST})`
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export interface AiTotals {
  calls: number
  cost_inr: number
  price_inr: number
  failed: number
  unpaid: number
}

export async function aiTotals(p: Period): Promise<AiTotals> {
  const row = await queryOne<Record<string, string>>(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_inr), 0) AS cost_inr, COALESCE(SUM(price_inr) FILTER (WHERE status IN ('ok', 'pending')), 0) AS price_inr,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed, COUNT(*) FILTER (WHERE status = 'unpaid') AS unpaid
     FROM ai_usage WHERE ${inPeriod}`,
    [p.from, p.to]
  ).catch(() => null)
  return { calls: n(row?.calls), cost_inr: n(row?.cost_inr), price_inr: n(row?.price_inr), failed: n(row?.failed), unpaid: n(row?.unpaid) }
}

type Grouped = { key: string; calls: number; cost_inr: number; price_inr: number; failed: number }

async function groupBy(col: 'capability' | 'provider' | 'feature', p: Period): Promise<Grouped[]> {
  const rows = await queryMany<Record<string, string>>(
    `SELECT ${col} AS key, COUNT(*) AS calls, COALESCE(SUM(cost_inr), 0) AS cost_inr,
       COALESCE(SUM(price_inr) FILTER (WHERE status IN ('ok', 'pending')), 0) AS price_inr, COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM ai_usage WHERE ${inPeriod} GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
    [p.from, p.to]
  ).catch(() => [])
  return rows.map(r => ({ key: r.key, calls: n(r.calls), cost_inr: n(r.cost_inr), price_inr: n(r.price_inr), failed: n(r.failed) }))
}

export async function getAiCosts(p: Period, opts: { flagship: boolean }) {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const amount = opts.flagship ? 'cost_inr' : `CASE WHEN status IN ('ok', 'pending') THEN price_inr ELSE 0 END`
  const [current, previous, byCapability, byProvider, byFeature, seriesRows, topRefs] = await Promise.all([
    aiTotals(p),
    aiTotals(prev),
    groupBy('capability', p),
    groupBy('provider', p),
    groupBy('feature', p),
    queryMany<{ b: string; k: string; v: string }>(
      `SELECT date_trunc($3::text, (created_at AT TIME ZONE ${IST})::date)::date::text AS b, provider AS k, SUM(${amount}) AS v
       FROM ai_usage WHERE ${inPeriod} GROUP BY 1, 2`,
      [p.from, p.to, bucket]
    ).catch(() => []),
    queryMany<Record<string, string>>(
      `SELECT ref, MIN(feature) AS feature, COUNT(*) AS calls, COALESCE(SUM(cost_inr), 0) AS cost_inr,
         COALESCE(SUM(price_inr) FILTER (WHERE status IN ('ok', 'pending')), 0) AS price_inr
       FROM ai_usage WHERE ${inPeriod} AND ref IS NOT NULL GROUP BY ref ORDER BY ${opts.flagship ? 4 : 5} DESC, 3 DESC LIMIT 10`,
      [p.from, p.to]
    ).catch(() => []),
  ])
  const providers = byProvider.map(r => r.key)
  return {
    range: p,
    previous_range: prev,
    bucket,
    flagship: opts.flagship,
    current,
    previous,
    by_capability: byCapability,
    by_provider: byProvider,
    by_feature: byFeature,
    providers,
    series: fillSeries(p, bucket, providers, seriesRows),
    top_refs: topRefs.map(r => ({ ref: r.ref, feature: r.feature, calls: n(r.calls), cost_inr: n(r.cost_inr), price_inr: n(r.price_inr) })),
  }
}

export type AiCosts = Awaited<ReturnType<typeof getAiCosts>>
