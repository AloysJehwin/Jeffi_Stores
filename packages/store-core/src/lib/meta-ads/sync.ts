import type { PoolClient } from 'pg'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { bulkInsert, istDate } from '@/lib/channels/report-store'
import { fromMinor, metaAdsGraph, type MetaGraph } from './client'

// Meta ad account into mads_*: campaigns, ad sets and ads, daily insights per ad for the last 30 days
// (Meta restates up to 28 days) and 30-day breakdowns by age and gender, placement and region.

export const INSIGHT_DAYS = 30
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)

/** Purchases and value from an insights row: the first purchase action type Meta reports (they overlap). */
export function purchaseOf(row: any): { purchases: number; value: number } {
  const pick = (list: any[] | undefined) => {
    for (const t of PURCHASE) {
      const hit = (list ?? []).find(a => a?.action_type === t)
      if (hit) return n(hit.value)
    }
    return 0
  }
  return { purchases: pick(row?.actions), value: pick(row?.action_values) }
}

export function linkClicksOf(row: any): number {
  return n((row?.actions ?? []).find((a: any) => a?.action_type === 'link_click')?.value ?? row?.inline_link_clicks)
}

export function mapInsight(row: any): unknown[] {
  const p = purchaseOf(row)
  return [
    row.date_start,
    String(row.ad_id),
    row.adset_id ?? null,
    row.campaign_id ?? null,
    n(row.impressions),
    n(row.reach),
    n(row.clicks),
    linkClicksOf(row),
    n(row.spend),
    p.purchases,
    p.value,
  ]
}

const BREAKDOWNS: Record<string, { breakdowns: string; key: (r: any) => string }> = {
  age_gender: { breakdowns: 'age,gender', key: r => `${r.age ?? '?'} ${r.gender ?? '?'}` },
  placement: {
    breakdowns: 'publisher_platform,platform_position',
    key: r => `${r.publisher_platform ?? '?'} ${String(r.platform_position ?? '').replace(/_/g, ' ')}`.trim(),
  },
  region: { breakdowns: 'region', key: r => String(r.region ?? 'Unknown') },
}

async function replace(
  db: PoolClient,
  table: string,
  cols: string[],
  rows: unknown[][],
  where = '',
  params: unknown[] = []
) {
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM ${table} ${where}`, params)
    const count = await bulkInsert(db, table, cols, rows as any[][])
    await db.query('COMMIT')
    return count
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
}

export async function syncMetaAds(now = new Date()): Promise<RunResult> {
  const { graph, cfg } = await metaAdsGraph()
  const act = cfg.ad_account_id.startsWith('act_') ? cfg.ad_account_id : `act_${cfg.ad_account_id}`
  return withChannelLock('meta_ads', 'meta_ads_sync', 'sync', async ({ db, step }) => {
    await step('account', async () => {
      const a = await graph.get<any>(act, { fields: 'name,currency,timezone_name,account_status' })
      await db.query(
        `INSERT INTO mads_account (id, ad_account_id, name, currency, timezone, account_status, last_sync_at) VALUES (1,$1,$2,$3,$4,$5,now())
         ON CONFLICT (id) DO UPDATE SET ad_account_id=EXCLUDED.ad_account_id, name=EXCLUDED.name, currency=EXCLUDED.currency, timezone=EXCLUDED.timezone,
           account_status=EXCLUDED.account_status, last_sync_at=now()`,
        [act, a?.name ?? null, a?.currency ?? 'INR', a?.timezone_name ?? null, a?.account_status ?? null]
      )
    })
    await step('campaigns', async () =>
      replace(
        db,
        'mads_campaigns',
        [
          'campaign_id',
          'name',
          'status',
          'effective_status',
          'objective',
          'daily_budget',
          'lifetime_budget',
          'bid_strategy',
        ],
        (
          await graph.all<any>(`${act}/campaigns`, {
            fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy',
          })
        ).map(c => [
          String(c.id),
          String(c.name ?? ''),
          String(c.status),
          c.effective_status ?? null,
          c.objective ?? null,
          fromMinor(c.daily_budget),
          fromMinor(c.lifetime_budget),
          c.bid_strategy ?? null,
        ])
      )
    )
    await step('adsets', async () =>
      replace(
        db,
        'mads_adsets',
        ['adset_id', 'campaign_id', 'name', 'status', 'effective_status', 'daily_budget', 'optimization_goal'],
        (
          await graph.all<any>(`${act}/adsets`, {
            fields: 'id,campaign_id,name,status,effective_status,daily_budget,optimization_goal',
          })
        ).map(s => [
          String(s.id),
          String(s.campaign_id),
          String(s.name ?? ''),
          String(s.status),
          s.effective_status ?? null,
          fromMinor(s.daily_budget),
          s.optimization_goal ?? null,
        ])
      )
    )
    await step('ads', async () =>
      replace(
        db,
        'mads_ads',
        ['ad_id', 'adset_id', 'campaign_id', 'name', 'status', 'effective_status', 'thumbnail_url'],
        (
          await graph.all<any>(`${act}/ads`, {
            fields: 'id,adset_id,campaign_id,name,status,effective_status,creative{thumbnail_url}',
          })
        ).map(a => [
          String(a.id),
          String(a.adset_id),
          String(a.campaign_id),
          String(a.name ?? ''),
          String(a.status),
          a.effective_status ?? null,
          a.creative?.thumbnail_url ?? null,
        ])
      )
    )
    const since = istDate(now, INSIGHT_DAYS)
    const until = istDate(now, 0)
    await step('insights', async () => {
      const rows = await insights(graph, act, {
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since, until }),
      })
      return replace(
        db,
        'mads_daily_metrics',
        [
          'date',
          'ad_id',
          'adset_id',
          'campaign_id',
          'impressions',
          'reach',
          'clicks',
          'link_clicks',
          'spend',
          'purchases',
          'purchase_value',
        ],
        rows.filter(r => r.ad_id && r.date_start).map(mapInsight),
        'WHERE date BETWEEN $1 AND $2',
        [since, until]
      )
    })
    await step('breakdowns', async () => {
      const out: unknown[][] = []
      for (const [dimension, b] of Object.entries(BREAKDOWNS)) {
        const rows = await insights(graph, act, {
          level: 'account',
          breakdowns: b.breakdowns,
          time_range: JSON.stringify({ since, until }),
        })
        for (const r of rows) {
          const p = purchaseOf(r)
          out.push([dimension, b.key(r), n(r.impressions), n(r.clicks), n(r.spend), p.purchases, p.value])
        }
      }
      return replace(
        db,
        'mads_breakdowns',
        ['dimension', 'key', 'impressions', 'clicks', 'spend', 'purchases', 'purchase_value'],
        out
      )
    })
  })
}

async function insights(graph: MetaGraph, act: string, params: Record<string, string>): Promise<any[]> {
  return graph.all(`${act}/insights`, {
    fields:
      'ad_id,adset_id,campaign_id,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values,date_start',
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
    ...params,
  })
}
