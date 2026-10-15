import type { PoolClient } from 'pg'
import { getClient, queryOne } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'
import { googleAdsClientFor } from './credentials'
import {
  Q,
  mapAccountBudget,
  mapAd,
  mapAdGroup,
  mapCampaign,
  mapChangeEvent,
  mapCustomer,
  mapDaily,
  mapGeo,
  mapKeyword,
  mapProduct,
  mapRecommendation,
  mapSearchTerm,
  sumByKey,
  type DateRange,
} from './queries'

// Pulls the connected Google Ads account into the local ads_* tables. Date-ranged tables are
// replaced for the window (delete + insert) so rows Google stops reporting do not linger; entity
// tables are upserted. Runs under a session advisory lock on one dedicated connection, like
// lib/merchant/sync.ts, so a cron run and a manual "Sync now" never overlap.

export const ADS_SYNC_LOCK_KEY = 84219591
export const FULL_SYNC_DAYS = 30
const CHANGE_EVENT_DAYS = 14
const INSERT_CHUNK = 500

export type AdsSyncMode = 'full' | 'today'

export class AdsSyncInProgressError extends Error {
  constructor() {
    super('A Google Ads sync is already running. Try again when it finishes.')
    this.name = 'AdsSyncInProgressError'
  }
}

export interface AdsSyncResult {
  mode: AdsSyncMode
  status: 'success' | 'partial' | 'error'
  range: DateRange
  rows: Record<string, number>
  errors: { step: string; message: string }[]
  startedAt: string
  finishedAt: string
}

/** YYYY-MM-DD for `d` in an IANA time zone (the account's reporting zone). */
export function dateInZone(d: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Asia/Kolkata' }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
  }
}

export function syncRange(mode: AdsSyncMode, timeZone: string | null, now = new Date()): DateRange {
  const to = dateInZone(now, timeZone)
  if (mode === 'today') return { from: to, to }
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (FULL_SYNC_DAYS - 1))
  return { from: start.toISOString().slice(0, 10), to }
}

/** Multi-row INSERT in chunks; `conflict` is appended verbatim (e.g. an ON CONFLICT clause). */
export async function bulkInsert(
  db: Pick<PoolClient, 'query'>,
  table: string,
  cols: string[],
  rows: any[][],
  conflict = ''
): Promise<number> {
  let n = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const params: any[] = []
    const tuples = chunk.map(r => {
      const ph = r.map(v => {
        params.push(v)
        return `$${params.length}`
      })
      return `(${ph.join(',')})`
    })
    await db.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict}`, params)
    n += chunk.length
  }
  return n
}

const METRIC_COLS = ['impressions', 'clicks', 'cost_micros', 'conversions', 'conversions_value', 'all_conversions']
const metricVals = (r: any) => METRIC_COLS.map(c => r[c])
const upsertSet = (cols: string[]) => cols.map(c => `${c}=EXCLUDED.${c}`).join(', ')

/** Replace a date-ranged table's rows inside [from, to] in one transaction. */
async function replaceRange(db: PoolClient, table: string, range: DateRange, cols: string[], rows: any[][]) {
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM ${table} WHERE date BETWEEN $1 AND $2`, [range.from, range.to])
    const n = await bulkInsert(db, table, cols, rows)
    await db.query('COMMIT')
    return n
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
}

interface StepCtx {
  ads: GoogleAdsClient
  db: PoolClient
  range: DateRange
  rows: Record<string, number>
  errors: AdsSyncResult['errors']
}

async function step(ctx: StepCtx, name: string, fn: () => Promise<number>) {
  try {
    ctx.rows[name] = await fn()
  } catch (e: any) {
    ctx.errors.push({ step: name, message: String(e?.message ?? e).slice(0, 500) })
  }
}

async function syncAccount(ads: GoogleAdsClient, db: PoolClient, mode: AdsSyncMode) {
  const info = mapCustomer((await ads.searchStream(Q.customer()))[0] ?? {})
  if (!info.customer_id) throw new Error('Google Ads returned no customer row')
  let budget: ReturnType<typeof mapAccountBudget> = null
  if (mode === 'full') budget = mapAccountBudget(await ads.searchStream(Q.accountBudget()).catch(() => []))
  await db.query(
    `INSERT INTO ads_account (id, customer_id, descriptive_name, currency_code, time_zone, manager_id, test_account,
       status, optimization_score, budget_status, budget_limit_micros, budget_served_micros, budget_end, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (id) DO UPDATE SET customer_id=EXCLUDED.customer_id, descriptive_name=EXCLUDED.descriptive_name,
       currency_code=EXCLUDED.currency_code, time_zone=EXCLUDED.time_zone, manager_id=EXCLUDED.manager_id,
       test_account=EXCLUDED.test_account, status=EXCLUDED.status, optimization_score=EXCLUDED.optimization_score,
       budget_status=COALESCE(EXCLUDED.budget_status, ads_account.budget_status),
       budget_limit_micros=COALESCE(EXCLUDED.budget_limit_micros, ads_account.budget_limit_micros),
       budget_served_micros=COALESCE(EXCLUDED.budget_served_micros, ads_account.budget_served_micros),
       budget_end=COALESCE(EXCLUDED.budget_end, ads_account.budget_end), updated_at=now()`,
    [
      info.customer_id,
      info.descriptive_name,
      info.currency_code,
      info.time_zone,
      ads.loginCustomerId,
      info.test_account,
      info.status,
      info.optimization_score,
      budget?.budget_status ?? null,
      budget?.budget_limit_micros ?? null,
      budget?.budget_served_micros ?? null,
      budget?.budget_end ?? null,
    ]
  )
  return info
}

async function runSteps(ctx: StepCtx, mode: AdsSyncMode) {
  const { ads, db, range } = ctx

  await step(ctx, 'campaigns', async () => {
    const rows = (await ads.searchStream(Q.campaigns())).map(mapCampaign).filter(r => r.campaign_id)
    const cols = [
      'campaign_id', 'name', 'status', 'serving_status', 'primary_status', 'channel_type', 'channel_sub_type',
      'bidding_strategy_type', 'budget_amount_micros', 'budget_period', 'start_date', 'end_date',
    ]
    return bulkInsert(db, 'ads_campaigns', [...cols, 'updated_at'], rows.map(r => [...cols.map(c => (r as any)[c]), new Date()]),
      `ON CONFLICT (campaign_id) DO UPDATE SET ${upsertSet([...cols.slice(1), 'updated_at'])}`)
  })

  await step(ctx, 'daily_metrics', async () => {
    const campaign = (await ads.searchStream(Q.campaignDaily(range))).map(r => mapDaily(r, false))
    const adGroup = (await ads.searchStream(Q.adGroupDaily(range))).map(r => mapDaily(r, true))
    const rows = sumByKey([...campaign, ...adGroup].filter(r => r.campaign_id && r.date), r =>
      [r.date, r.campaign_id, r.ad_group_id, r.device, r.network].join('|'))
    const cols = ['date', 'campaign_id', 'ad_group_id', 'device', 'network', ...METRIC_COLS]
    return replaceRange(db, 'ads_daily_metrics', range, cols,
      rows.map(r => [r.date, r.campaign_id, r.ad_group_id, r.device, r.network, ...metricVals(r)]))
  })

  await step(ctx, 'product_metrics', async () => {
    const rows = sumByKey((await ads.searchStream(Q.products(range))).map(mapProduct).filter(r => r.item_id && r.campaign_id),
      r => [r.date, r.campaign_id, r.item_id].join('|'))
    const cols = ['date', 'item_id', 'campaign_id', 'product_title', ...METRIC_COLS]
    return replaceRange(db, 'ads_product_metrics', range, cols,
      rows.map(r => [r.date, r.item_id, r.campaign_id, r.product_title, ...metricVals(r)]))
  })

  await step(ctx, 'search_terms', async () => {
    const rows = sumByKey((await ads.searchStream(Q.searchTerms(range))).map(mapSearchTerm).filter(r => r.search_term && r.campaign_id),
      r => [r.date, r.campaign_id, r.ad_group_id, r.search_term].join('|'))
    const cols = ['date', 'campaign_id', 'ad_group_id', 'search_term', 'status', 'keyword_text', ...METRIC_COLS]
    return replaceRange(db, 'ads_search_terms', range, cols,
      rows.map(r => [r.date, r.campaign_id, r.ad_group_id, r.search_term, r.status, r.keyword_text, ...metricVals(r)]))
  })

  await step(ctx, 'geo_metrics', async () => {
    const raw = (await ads.searchStream(Q.geo(range))).map(mapGeo)
    const rows = sumByKey(raw, r => `${r.date}|${r.location}`)
    const names = new Map<string, string>()
    const ids = [...new Set(rows.map(r => r.location).filter(l => /^geoTargetConstants\/\d+$/.test(l)))]
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200)
      const found = await ads.searchStream(Q.geoNames(part)).catch(() => [])
      for (const g of found) {
        const c = g.geoTargetConstant ?? {}
        if (c.resourceName) names.set(c.resourceName, c.canonicalName || c.name)
      }
    }
    const cols = ['date', 'location', 'country_criterion_id', 'location_name', ...METRIC_COLS]
    return replaceRange(db, 'ads_geo_metrics', range, cols,
      rows.map(r => [r.date, r.location, r.country_criterion_id, names.get(r.location) ?? null, ...metricVals(r)]))
  })

  if (mode === 'today') return

  await step(ctx, 'ad_groups', async () => {
    const rows = (await ads.searchStream(Q.adGroups())).map(mapAdGroup).filter(r => r.ad_group_id && r.campaign_id)
    const cols = ['ad_group_id', 'campaign_id', 'name', 'status', 'type', 'cpc_bid_micros']
    return bulkInsert(db, 'ads_ad_groups', [...cols, 'updated_at'], rows.map(r => [...cols.map(c => (r as any)[c]), new Date()]),
      `ON CONFLICT (ad_group_id) DO UPDATE SET ${upsertSet([...cols.slice(1), 'updated_at'])}`)
  })

  await step(ctx, 'ads', async () => {
    const withMetrics = new Map((await ads.searchStream(Q.ads(range))).map(mapAd).map(a => [`${a.ad_group_id}|${a.ad_id}`, a]))
    const all = (await ads.searchStream(Q.adsNoMetrics())).map(mapAd).map(a => withMetrics.get(`${a.ad_group_id}|${a.ad_id}`) ?? a)
    const rows = all.filter(a => a.ad_id && a.ad_group_id && a.campaign_id)
    const cols = [
      'ad_group_id', 'ad_id', 'campaign_id', 'name', 'type', 'status', 'approval_status', 'review_status',
      'policy_topics', 'final_urls', 'headlines', 'impressions', 'clicks', 'cost_micros', 'conversions',
    ]
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM ads_ads')
      const n = await bulkInsert(db, 'ads_ads', cols, rows.map(r => cols.map(c => {
        const v = (r as any)[c]
        return Array.isArray(v) ? JSON.stringify(v) : v
      })))
      await db.query('COMMIT')
      return n
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {})
      throw e
    }
  })

  await step(ctx, 'keywords', async () => {
    const rows = (await ads.searchStream(Q.keywords(range))).map(mapKeyword).filter(k => k.criterion_id && k.ad_group_id)
    const cols = [
      'ad_group_id', 'criterion_id', 'campaign_id', 'text', 'match_type', 'status', 'negative', 'quality_score',
      'impressions', 'clicks', 'cost_micros', 'conversions', 'conversions_value',
    ]
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM ads_keywords')
      const n = await bulkInsert(db, 'ads_keywords', cols, rows.map(r => cols.map(c => (r as any)[c])))
      await db.query('COMMIT')
      return n
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {})
      throw e
    }
  })

  await step(ctx, 'recommendations', async () => {
    const rows = (await ads.searchStream(Q.recommendations())).map(mapRecommendation).filter(r => r.resource_name)
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM ads_recommendations')
      const n = await bulkInsert(db, 'ads_recommendations', ['resource_name', 'type', 'campaign_id', 'impact', 'dismissed'],
        rows.map(r => [r.resource_name, r.type, r.campaign_id, r.impact ? JSON.stringify(r.impact) : null, r.dismissed]))
      await db.query('COMMIT')
      return n
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {})
      throw e
    }
  })

  await step(ctx, 'change_events', async () => {
    const since = new Date(`${range.to}T00:00:00Z`)
    since.setUTCDate(since.getUTCDate() - (CHANGE_EVENT_DAYS - 1))
    const rows = (await ads.searchStream(Q.changeEvents(`${since.toISOString().slice(0, 10)} 00:00:00`))).map(mapChangeEvent)
      .filter(r => r.resource_name)
    const cols = ['resource_name', 'change_date_time', 'resource_type', 'changed_resource', 'operation', 'client_type',
      'user_email', 'campaign_id', 'changed_fields']
    const n = await bulkInsert(db, 'ads_change_events', cols, rows.map(r => cols.map(c => (r as any)[c])),
      `ON CONFLICT (resource_name) DO NOTHING`)
    await db.query(`DELETE FROM ads_change_events WHERE change_date_time < now() - interval '90 days'`)
    return n
  })
}

async function writeLog(db: Pick<PoolClient, 'query'>, r: AdsSyncResult) {
  await db
    .query(
      `INSERT INTO ads_sync_log (mode, status, date_from, date_to, rows, errors, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [r.mode, r.status, r.range.from, r.range.to, JSON.stringify(r.rows), JSON.stringify(r.errors), r.startedAt, r.finishedAt]
    )
    .catch(() => {})
}

/** Sync the current tenant's (or flagship's) Google Ads account. Throws AdsSyncInProgressError on overlap. */
export async function syncGoogleAds(
  mode: AdsSyncMode = 'full',
  opts: { client?: GoogleAdsClient; now?: Date } = {}
): Promise<AdsSyncResult> {
  const db = await getClient()
  let locked = false
  let unlockFailed = false
  try {
    const lock = await db.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1) AS acquired', [ADS_SYNC_LOCK_KEY])
    locked = !!lock.rows[0]?.acquired
    if (!locked) throw new AdsSyncInProgressError()

    const startedAt = new Date().toISOString()
    const rows: Record<string, number> = {}
    const errors: AdsSyncResult['errors'] = []
    let range: DateRange = syncRange(mode, null, opts.now)
    const finish = async (status: AdsSyncResult['status']) => {
      const result: AdsSyncResult = { mode, status, range, rows, errors, startedAt, finishedAt: new Date().toISOString() }
      await writeLog(db, result)
      return result
    }

    let ads: GoogleAdsClient
    try {
      ads = opts.client ?? (await googleAdsClientFor())
      const info = await syncAccount(ads, db, mode)
      range = syncRange(mode, info.time_zone, opts.now)
    } catch (e: any) {
      errors.push({ step: 'account', message: String(e?.message ?? e).slice(0, 500) })
      return await finish('error')
    }

    await runSteps({ ads, db, range, rows, errors }, mode)
    await db.query(
      `UPDATE ads_account SET last_sync_at = now()${mode === 'full' && errors.length === 0 ? ', last_full_sync_at = now()' : ''} WHERE id = 1`
    )
    const stepCount = Object.keys(rows).length + errors.length
    return await finish(errors.length === 0 ? 'success' : errors.length >= stepCount ? 'error' : 'partial')
  } finally {
    if (locked) {
      await db.query('SELECT pg_advisory_unlock($1)', [ADS_SYNC_LOCK_KEY]).catch(() => {
        unlockFailed = true
      })
    }
    db.release(unlockFailed || undefined)
  }
}

export async function isAdsSyncRunning(): Promise<boolean> {
  try {
    const row = await queryOne<{ running: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND classid = 0 AND objid = $1 AND objsubid = 1
       ) AS running`,
      [ADS_SYNC_LOCK_KEY]
    )
    return !!row?.running
  } catch {
    return false
  }
}
