import { gunzipSync } from 'zlib'
import type { PoolClient } from 'pg'
import { queryMany, queryOne } from '@/lib/shared/db'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { bulkInsert, istDate } from '@/lib/channels/report-store'
import { amazonAdsClient, type AmazonAdsClient } from './client'

// Sponsored Products into the aads_* tables: entities (campaigns, ad groups, keywords, negatives,
// product ads) every run, and daily reports (campaigns, search terms, advertised products) through
// Reporting v3, which builds reports asynchronously: one run requests, a later run collects.
// Amazon restates attribution for up to 14 days, so each request covers the last 14 days.

export const REPORT_DAYS = 14

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)

export function mapCampaign(c: any) {
  return [
    String(c.campaignId),
    String(c.name ?? ''),
    String(c.state ?? 'UNKNOWN'),
    c.targetingType ?? null,
    c.budget?.budget ?? null,
    c.dynamicBidding?.strategy ?? null,
    c.startDate ?? null,
    c.endDate ?? null,
  ]
}

const REPORTS = {
  campaigns: {
    reportTypeId: 'spCampaigns',
    groupBy: ['campaign'],
    columns: ['date', 'campaignId', 'impressions', 'clicks', 'cost', 'sales7d', 'purchases7d', 'unitsSoldClicks7d'],
  },
  searchTerms: {
    reportTypeId: 'spSearchTerm',
    groupBy: ['searchTerm'],
    columns: ['date', 'campaignId', 'adGroupId', 'keywordId', 'searchTerm', 'impressions', 'clicks', 'cost', 'sales7d', 'purchases7d'],
  },
  products: {
    reportTypeId: 'spAdvertisedProduct',
    groupBy: ['advertiser'],
    columns: ['date', 'campaignId', 'adGroupId', 'advertisedSku', 'advertisedAsin', 'impressions', 'clicks', 'cost', 'sales7d', 'purchases7d', 'unitsSoldClicks7d'],
  },
} as const
export type ReportKind = keyof typeof REPORTS

export function mapReportRows(kind: ReportKind, rows: any[]): unknown[][] {
  const merged = new Map<string, unknown[]>()
  const add = (key: string, row: unknown[], metricsFrom: number) => {
    const prev = merged.get(key)
    if (prev) for (let i = metricsFrom; i < row.length; i++) prev[i] = num(prev[i]) + num(row[i])
    else merged.set(key, row)
  }
  for (const r of rows) {
    if (!r?.date) continue
    if (kind === 'campaigns') {
      add(`${r.date}|${r.campaignId}`, [r.date, String(r.campaignId), num(r.impressions), num(r.clicks), num(r.cost), num(r.sales7d), num(r.purchases7d), num(r.unitsSoldClicks7d)], 2)
    } else if (kind === 'searchTerms') {
      if (!r.searchTerm) continue
      const k = [r.date, r.campaignId, r.adGroupId, r.keywordId ?? '', r.searchTerm]
      add(k.join('|'), [r.date, String(r.campaignId), String(r.adGroupId), String(r.keywordId ?? ''), String(r.searchTerm), num(r.impressions), num(r.clicks), num(r.cost), num(r.sales7d), num(r.purchases7d)], 5)
    } else {
      const k = [r.date, r.campaignId, r.adGroupId, r.advertisedSku ?? '']
      add(k.join('|'), [r.date, String(r.campaignId), String(r.adGroupId), String(r.advertisedSku ?? ''), r.advertisedAsin ?? null, num(r.impressions), num(r.clicks), num(r.cost), num(r.sales7d), num(r.purchases7d), num(r.unitsSoldClicks7d)], 5)
    }
  }
  return [...merged.values()]
}

const TABLE: Record<ReportKind, { table: string; cols: string[] }> = {
  campaigns: { table: 'aads_daily_metrics', cols: ['date', 'campaign_id', 'impressions', 'clicks', 'cost', 'sales', 'orders', 'units'] },
  searchTerms: { table: 'aads_search_terms', cols: ['date', 'campaign_id', 'ad_group_id', 'keyword_id', 'search_term', 'impressions', 'clicks', 'cost', 'sales', 'orders'] },
  products: { table: 'aads_product_metrics', cols: ['date', 'campaign_id', 'ad_group_id', 'sku', 'asin', 'impressions', 'clicks', 'cost', 'sales', 'orders', 'units'] },
}

async function requestReport(ads: AmazonAdsClient, kind: ReportKind, start: string, end: string): Promise<string> {
  const r = REPORTS[kind]
  const res = await ads.request<any>('POST', '/reporting/reports', {
    contentType: 'application/vnd.createasyncreportrequest.v3+json',
    body: {
      name: `jeffi ${kind} ${start} ${end}`,
      startDate: start,
      endDate: end,
      configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: r.groupBy, columns: r.columns, reportTypeId: r.reportTypeId, timeUnit: 'DAILY', format: 'GZIP_JSON' },
    },
  })
  if (!res?.reportId) throw new Error('Amazon Ads returned no report id')
  return String(res.reportId)
}

async function collect(ads: AmazonAdsClient, db: PoolClient, req: { report_id: string; report_type: ReportKind; start_date: string; end_date: string }): Promise<number> {
  const r = await ads.request<any>('GET', `/reporting/reports/${encodeURIComponent(req.report_id)}`, { contentType: 'application/vnd.createasyncreportrequest.v3+json' })
  if (r?.status === 'PENDING' || r?.status === 'PROCESSING') return 0
  if (r?.status !== 'COMPLETED' || !r.url) {
    await db.query(`UPDATE aads_report_requests SET status = 'failed', error = $2, collected_at = now() WHERE report_id = $1`, [req.report_id, String(r?.failureReason ?? r?.status ?? 'failed')])
    return 0
  }
  const file = await fetch(r.url)
  if (!file.ok) throw new Error(`Report download failed (${file.status})`)
  const rows = JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8'))
  const mapped = mapReportRows(req.report_type, Array.isArray(rows) ? rows : [])
  const t = TABLE[req.report_type]
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM ${t.table} WHERE date BETWEEN $1 AND $2`, [req.start_date, req.end_date])
    await bulkInsert(db, t.table, t.cols, mapped as any[][])
    await db.query(`UPDATE aads_report_requests SET status = 'done', collected_at = now() WHERE report_id = $1`, [req.report_id])
    await db.query(`UPDATE aads_profile SET last_report_at = now() WHERE id = 1`)
    await db.query('COMMIT')
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
  return mapped.length
}

async function syncEntities(ads: AmazonAdsClient, db: PoolClient, step: (n: string, f: () => Promise<number | void>) => Promise<void>) {
  const replace = async (table: string, cols: string[], rows: unknown[][]) => {
    await db.query('BEGIN')
    try {
      await db.query(`DELETE FROM ${table}`)
      const n = await bulkInsert(db, table, cols, rows as any[][])
      await db.query('COMMIT')
      return n
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {})
      throw e
    }
  }
  await step('campaigns', async () =>
    replace(
      'aads_campaigns',
      ['campaign_id', 'name', 'state', 'targeting_type', 'daily_budget', 'bidding_strategy', 'start_date', 'end_date'],
      (await ads.list('/sp/campaigns/list', 'spCampaign', 'campaigns')).map(mapCampaign)
    )
  )
  await step('ad_groups', async () =>
    replace(
      'aads_ad_groups',
      ['ad_group_id', 'campaign_id', 'name', 'state', 'default_bid'],
      (await ads.list('/sp/adGroups/list', 'spAdGroup', 'adGroups')).map((g: any) => [String(g.adGroupId), String(g.campaignId), String(g.name ?? ''), String(g.state), g.defaultBid ?? null])
    )
  )
  await step('keywords', async () => {
    const [kw, neg] = await Promise.all([
      ads.list('/sp/keywords/list', 'spKeyword', 'keywords'),
      ads.list('/sp/negativeKeywords/list', 'spNegativeKeyword', 'negativeKeywords'),
    ])
    const rows = [
      ...kw.map((k: any) => [String(k.keywordId), String(k.adGroupId), String(k.campaignId), String(k.keywordText), String(k.matchType), String(k.state), k.bid ?? null, false]),
      ...neg.map((k: any) => [String(k.keywordId), String(k.adGroupId), String(k.campaignId), String(k.keywordText), String(k.matchType), String(k.state), null, true]),
    ]
    return replace('aads_keywords', ['keyword_id', 'ad_group_id', 'campaign_id', 'keyword_text', 'match_type', 'state', 'bid', 'negative'], rows)
  })
  await step('product_ads', async () =>
    replace(
      'aads_product_ads',
      ['ad_id', 'ad_group_id', 'campaign_id', 'sku', 'asin', 'state'],
      (await ads.list('/sp/productAds/list', 'spProductAd', 'productAds')).map((a: any) => [String(a.adId), String(a.adGroupId), String(a.campaignId), a.sku ?? null, a.asin ?? null, String(a.state)])
    )
  )
}

/** Entities now; reports requested now and collected on the next run (cron every 3 hours). */
export async function syncAmazonAds(now = new Date()): Promise<RunResult> {
  const ads = await amazonAdsClient()
  return withChannelLock('amazon_ads', 'amazon_ads_sync', 'sync', async ({ db, step }) => {
    await syncEntities(ads, db, step)
    const pending = await queryMany<any>(
      `SELECT report_id, report_type, start_date::text, end_date::text FROM aads_report_requests WHERE status = 'requested' ORDER BY requested_at`
    )
    for (const p of pending) await step(`report_${p.report_type}`, () => collect(ads, db, p))
    await step('requested', async () => {
      const recent = await queryOne(`SELECT 1 FROM aads_report_requests WHERE status = 'requested' OR requested_at > now() - interval '5 hours' LIMIT 1`)
      if (recent) return 0
      const start = istDate(now, REPORT_DAYS)
      const end = istDate(now, 1)
      let n = 0
      for (const kind of Object.keys(REPORTS) as ReportKind[]) {
        const id = await requestReport(ads, kind, start, end)
        await db.query(`INSERT INTO aads_report_requests (report_id, report_type, start_date, end_date) VALUES ($1,$2,$3,$4)`, [id, kind, start, end])
        n++
      }
      return n
    })
    await db.query(`UPDATE aads_profile SET last_sync_at = now() WHERE id = 1`)
  })
}
