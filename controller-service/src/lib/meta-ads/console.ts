import { z } from 'zod'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import type { ChangeActor } from '@/lib/channels/types'
import { metaAdsGraph, toMinor } from './client'

// Read side of the Meta Ads console and changes. Meta validates a change without applying it
// (execution_options validate_only), so the preview asks Meta first.

export const MADS_TABS = [
  'overview',
  'campaigns',
  'adsets',
  'ads',
  'breakdowns',
  'capi',
  'alerts',
  'changes',
  'runs',
] as const
export type MadsTab = (typeof MADS_TABS)[number]

export interface Range {
  from: string
  to: string
}

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)
const ratio = (a: number, b: number) => (b ? a / b : null)

export function kpis(r: any) {
  const k = {
    impressions: n(r.impressions),
    reach: n(r.reach),
    clicks: n(r.clicks),
    linkClicks: n(r.link_clicks),
    spend: n(r.spend),
    purchases: n(r.purchases),
    value: n(r.purchase_value),
  }
  return {
    ...k,
    ctr: ratio(k.linkClicks, k.impressions),
    cpc: ratio(k.spend, k.linkClicks),
    cpa: ratio(k.spend, k.purchases),
    roas: ratio(k.value, k.spend),
  }
}

const SUMS = `COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(reach),0) AS reach, COALESCE(SUM(clicks),0) AS clicks,
  COALESCE(SUM(link_clicks),0) AS link_clicks, COALESCE(SUM(spend),0) AS spend, COALESCE(SUM(purchases),0) AS purchases, COALESCE(SUM(purchase_value),0) AS purchase_value`

function previous(r: Range): Range {
  const from = new Date(`${r.from}T00:00:00Z`).getTime()
  const to = new Date(`${r.to}T00:00:00Z`).getTime()
  const days = Math.round((to - from) / 86_400_000) + 1
  const pTo = from - 86_400_000
  return {
    from: new Date(pTo - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    to: new Date(pTo).toISOString().slice(0, 10),
  }
}

/** Our own revenue from orders that came from Meta (fbc set, or utm_source facebook/instagram). */
async function ourMetaRevenue(r: Range): Promise<{ orders: number; revenue: number }> {
  const row = await queryOne<any>(
    `SELECT count(*) AS orders, COALESCE(SUM(total_amount), 0) AS revenue FROM orders
     WHERE created_at::date BETWEEN $1 AND $2 AND status <> 'cancelled'
       AND (meta_click_ids ? 'fbc' OR lower(COALESCE(utm_source, '')) IN ('facebook', 'fb', 'instagram', 'ig', 'meta'))`,
    [r.from, r.to]
  ).catch(() => null)
  return { orders: n(row?.orders), revenue: n(row?.revenue) }
}

export async function loadOverview(r: Range) {
  const p = previous(r)
  const [cur, prev, daily, ours, account] = await Promise.all([
    queryOne<any>(`SELECT ${SUMS} FROM mads_daily_metrics WHERE date BETWEEN $1 AND $2`, [r.from, r.to]),
    queryOne<any>(`SELECT ${SUMS} FROM mads_daily_metrics WHERE date BETWEEN $1 AND $2`, [p.from, p.to]),
    queryMany<any>(
      `SELECT date::text AS date, ${SUMS} FROM mads_daily_metrics WHERE date BETWEEN $1 AND $2 GROUP BY date ORDER BY date`,
      [r.from, r.to]
    ),
    ourMetaRevenue(r),
    queryOne<any>(`SELECT * FROM mads_account WHERE id = 1`),
  ])
  const k = kpis(cur ?? {})
  return {
    kpis: k,
    previous: kpis(prev ?? {}),
    daily: daily.map(d => ({ date: d.date, ...kpis(d) })),
    ours,
    trueRoas: k.spend ? ours.revenue / k.spend : null,
    account,
  }
}

export async function loadEntities(tab: 'campaigns' | 'adsets' | 'ads', r: Range) {
  const spec = {
    campaigns: { table: 'mads_campaigns', id: 'campaign_id', join: 'campaign_id' },
    adsets: { table: 'mads_adsets', id: 'adset_id', join: 'adset_id' },
    ads: { table: 'mads_ads', id: 'ad_id', join: 'ad_id' },
  }[tab]
  const rows = await queryMany<any>(
    `SELECT e.*, m.impressions, m.reach, m.clicks, m.link_clicks, m.spend, m.purchases, m.purchase_value
     FROM ${spec.table} e LEFT JOIN (SELECT ${spec.join}, ${SUMS} FROM mads_daily_metrics WHERE date BETWEEN $1 AND $2 GROUP BY ${spec.join}) m ON m.${spec.join} = e.${spec.id}
     ORDER BY COALESCE(m.spend, 0) DESC, e.name LIMIT 2000`,
    [r.from, r.to]
  )
  return {
    rows: rows.map(e => ({
      id: e[spec.id],
      name: e.name,
      status: e.status,
      effective: e.effective_status,
      objective: e.objective ?? e.optimization_goal ?? null,
      dailyBudget: e.daily_budget == null ? null : Number(e.daily_budget),
      thumbnail: e.thumbnail_url ?? null,
      ...kpis(e),
    })),
  }
}

export async function loadBreakdowns() {
  const rows = await queryMany<any>(`SELECT * FROM mads_breakdowns ORDER BY dimension, spend DESC`)
  const by: Record<string, any[]> = {}
  for (const r of rows) (by[r.dimension] ??= []).push({ key: r.key, ...kpis(r) })
  return { breakdowns: by, refreshedAt: rows[0]?.refreshed_at ?? null }
}

export async function loadCapi() {
  const [counts, recent, keys] = await Promise.all([
    queryOne<any>(
      `SELECT count(*) FILTER (WHERE status = 'sent') AS sent, count(*) FILTER (WHERE status = 'failed') AS failed, count(*) FILTER (WHERE status = 'skipped') AS skipped,
              max(sent_at) AS last_sent FROM mads_capi_events WHERE created_at > now() - interval '30 days'`
    ),
    queryMany<any>(
      `SELECT e.*, o.order_number FROM mads_capi_events e LEFT JOIN orders o ON o.id = e.order_id ORDER BY e.created_at DESC LIMIT 200`
    ),
    queryMany<any>(
      `SELECT k, count(*) AS n FROM mads_capi_events, unnest(matched_keys) k WHERE status = 'sent' AND created_at > now() - interval '30 days' GROUP BY k`
    ),
  ])
  return { counts, recent, matchedKeys: Object.fromEntries(keys.map(k => [k.k, n(k.n)])) }
}

export async function loadMadsTab(tab: MadsTab, r: Range) {
  switch (tab) {
    case 'overview':
      return loadOverview(r)
    case 'campaigns':
    case 'adsets':
    case 'ads':
      return loadEntities(tab, r)
    case 'breakdowns':
      return loadBreakdowns()
    case 'capi':
      return loadCapi()
    default:
      return {}
  }
}

// ---- Changes ----

const id = z.string().regex(/^\d{1,30}$/)
export const MadsActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    level: z.enum(['campaign', 'adset', 'ad']),
    id,
    status: z.enum(['ACTIVE', 'PAUSED']),
  }),
  z.object({
    action: z.literal('budget'),
    level: z.enum(['campaign', 'adset']),
    id,
    dailyBudget: z.number().positive().max(10_000_000),
  }),
])
export type MadsAction = z.infer<typeof MadsActionSchema>

const TABLE = {
  campaign: ['mads_campaigns', 'campaign_id'],
  adset: ['mads_adsets', 'adset_id'],
  ad: ['mads_ads', 'ad_id'],
} as const
export const MIN_DAILY_BUDGET = 100

export function budgetProblems(next: number, current: number | null): string[] {
  const out: string[] = []
  if (next < MIN_DAILY_BUDGET) out.push(`Use a daily budget of at least ${MIN_DAILY_BUDGET}.`)
  if (current && next / current > 5) out.push('That is more than 5x the current budget; raise it in steps.')
  return out
}

export async function runMadsAction(
  a: MadsAction,
  actor: ChangeActor,
  preview: boolean
): Promise<ChangeOutcome<unknown>> {
  const [table, col] = TABLE[a.level]
  const row = await queryOne<any>(
    `SELECT name, status, ${a.level === 'ad' ? 'NULL AS daily_budget' : 'daily_budget'} FROM ${table} WHERE ${col} = $1`,
    [a.id]
  )
  const before = row
    ? { status: row.status, dailyBudget: row.daily_budget == null ? null : Number(row.daily_budget) }
    : null
  const params = a.action === 'status' ? { status: a.status } : { daily_budget: String(toMinor(a.dailyBudget)) }
  const send = async (validateOnly: boolean) => {
    const { graph } = await metaAdsGraph()
    return graph.post(a.id, { ...params, ...(validateOnly ? { execution_options: ['validate_only'] } : {}) })
  }
  return runChange(
    {
      channel: 'meta_ads',
      action: `${a.level}.${a.action}`,
      entityType: a.level,
      entityId: a.id,
      summary:
        a.action === 'status'
          ? `${a.status === 'PAUSED' ? 'Paused' : 'Activated'} ${a.level} "${row?.name ?? a.id}"`
          : `Set the daily budget of ${a.level} "${row?.name ?? a.id}" to ${a.dailyBudget}`,
      before,
      after: a.action === 'status' ? { ...before, status: a.status } : { ...before, dailyBudget: a.dailyBudget },
      validate: async () => {
        if (!row) return ['Not found; sync first.']
        if (a.action === 'budget') {
          if (before?.dailyBudget == null)
            return ['This uses a lifetime budget or a budget on its campaign; change it in Ads Manager.']
          const p = budgetProblems(a.dailyBudget, before.dailyBudget)
          if (p.length) return p
        }
        await send(true)
        return []
      },
      apply: async () => {
        const res = await send(false)
        await query(
          a.action === 'status'
            ? `UPDATE ${table} SET status = $2 WHERE ${col} = $1`
            : `UPDATE ${table} SET daily_budget = $2 WHERE ${col} = $1`,
          [a.id, a.action === 'status' ? a.status : a.dailyBudget]
        )
        return res
      },
    },
    actor,
    preview
  )
}
