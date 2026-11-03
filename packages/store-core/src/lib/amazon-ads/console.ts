import { z } from 'zod'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import type { ChangeActor } from '@/lib/channels/types'
import { amazonAdsClient, multiStatusErrors } from './client'

// Read side of the Amazon Ads console, and changes. Amazon Ads has no validate-only mode, so the
// preview checks locally (Amazon's limits for India, and no more than a 5x jump at once).

export const AADS_TABS = ['overview', 'campaigns', 'keywords', 'searchterms', 'products', 'alerts', 'changes', 'runs'] as const
export type AadsTab = (typeof AADS_TABS)[number]

export interface Range {
  from: string
  to: string
}

export const LIMITS = { minBudget: 50, maxBudget: 1_000_000, minBid: 1, maxBid: 2000, maxJump: 5 }

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)
const ratio = (a: number, b: number) => (b ? a / b : null)

function previous(r: Range): Range {
  const from = new Date(`${r.from}T00:00:00Z`)
  const to = new Date(`${r.to}T00:00:00Z`)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  const pTo = new Date(from.getTime() - 86_400_000)
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86_400_000)
  return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) }
}

export interface Kpis {
  impressions: number
  clicks: number
  cost: number
  sales: number
  orders: number
  ctr: number | null
  cpc: number | null
  acos: number | null
  roas: number | null
}

export function kpis(r: { impressions?: unknown; clicks?: unknown; cost?: unknown; sales?: unknown; orders?: unknown }): Kpis {
  const k = { impressions: n(r.impressions), clicks: n(r.clicks), cost: n(r.cost), sales: n(r.sales), orders: n(r.orders) }
  return { ...k, ctr: ratio(k.clicks, k.impressions), cpc: ratio(k.cost, k.clicks), acos: ratio(k.cost, k.sales), roas: ratio(k.sales, k.cost) }
}

const SUMS = `COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(cost),0) AS cost,
  COALESCE(SUM(sales),0) AS sales, COALESCE(SUM(orders),0) AS orders`

async function totals(r: Range): Promise<Kpis> {
  return kpis((await queryOne<any>(`SELECT ${SUMS} FROM aads_daily_metrics WHERE date BETWEEN $1 AND $2`, [r.from, r.to])) ?? {})
}

export async function loadOverview(r: Range) {
  const p = previous(r)
  const [cur, prev, daily, total, profile] = await Promise.all([
    totals(r),
    totals(p),
    queryMany<any>(`SELECT date::text AS date, ${SUMS} FROM aads_daily_metrics WHERE date BETWEEN $1 AND $2 GROUP BY date ORDER BY date`, [r.from, r.to]),
    queryOne<any>(`SELECT COALESCE(SUM(ordered_sales), 0) AS sales, count(*) AS days FROM amazon_sales_traffic_daily WHERE date BETWEEN $1 AND $2`, [r.from, r.to]).catch(() => null),
    queryOne<any>(`SELECT * FROM aads_profile WHERE id = 1`),
  ])
  const totalSales = n(total?.sales)
  return {
    kpis: cur,
    previous: prev,
    tacos: totalSales && n(total?.days) ? cur.cost / totalSales : null,
    totalSales,
    daily: daily.map(d => ({ date: d.date, ...kpis(d) })),
    profile,
  }
}

export async function loadCampaigns(r: Range) {
  const rows = await queryMany<any>(
    `SELECT c.*, m.impressions, m.clicks, m.cost, m.sales, m.orders FROM aads_campaigns c
     LEFT JOIN (SELECT campaign_id, ${SUMS} FROM aads_daily_metrics WHERE date BETWEEN $1 AND $2 GROUP BY campaign_id) m ON m.campaign_id = c.campaign_id
     ORDER BY COALESCE(m.cost, 0) DESC, c.name`,
    [r.from, r.to]
  )
  return { rows: rows.map(c => ({ campaignId: c.campaign_id, name: c.name, state: c.state, targeting: c.targeting_type, budget: c.daily_budget == null ? null : Number(c.daily_budget), strategy: c.bidding_strategy, ...kpis(c) })) }
}

export async function loadKeywords(r: Range) {
  const rows = await queryMany<any>(
    `SELECT k.*, c.name AS campaign_name, g.name AS ad_group_name, m.impressions, m.clicks, m.cost, m.sales, m.orders
     FROM aads_keywords k
     LEFT JOIN aads_campaigns c ON c.campaign_id = k.campaign_id LEFT JOIN aads_ad_groups g ON g.ad_group_id = k.ad_group_id
     LEFT JOIN (SELECT keyword_id, ${SUMS} FROM aads_search_terms WHERE date BETWEEN $1 AND $2 GROUP BY keyword_id) m ON m.keyword_id = k.keyword_id
     ORDER BY k.negative, COALESCE(m.cost, 0) DESC LIMIT 3000`,
    [r.from, r.to]
  )
  return {
    rows: rows.map(k => ({
      keywordId: k.keyword_id,
      text: k.keyword_text,
      matchType: k.match_type,
      state: k.state,
      bid: k.bid == null ? null : Number(k.bid),
      negative: k.negative,
      campaignId: k.campaign_id,
      adGroupId: k.ad_group_id,
      campaign: k.campaign_name,
      adGroup: k.ad_group_name,
      ...kpis(k),
    })),
  }
}

/** Search terms with what to do about them: converting terms not yet an exact keyword in that ad
 * group are harvest candidates; terms with clicks and no orders are waste candidates. */
export async function loadSearchTerms(r: Range, opts: { harvestOrders?: number; wasteClicks?: number } = {}) {
  const harvest = opts.harvestOrders ?? 2
  const waste = opts.wasteClicks ?? 10
  const rows = await queryMany<any>(
    `SELECT t.search_term, t.campaign_id, t.ad_group_id, c.name AS campaign_name, g.name AS ad_group_name, ${SUMS},
       EXISTS (SELECT 1 FROM aads_keywords k WHERE k.ad_group_id = t.ad_group_id AND lower(k.keyword_text) = lower(t.search_term) AND k.match_type = 'EXACT' AND NOT k.negative) AS is_exact,
       EXISTS (SELECT 1 FROM aads_keywords k WHERE k.ad_group_id = t.ad_group_id AND lower(k.keyword_text) = lower(t.search_term) AND k.negative) AS is_negative
     FROM aads_search_terms t LEFT JOIN aads_campaigns c ON c.campaign_id = t.campaign_id LEFT JOIN aads_ad_groups g ON g.ad_group_id = t.ad_group_id
     WHERE t.date BETWEEN $1 AND $2
     GROUP BY t.search_term, t.campaign_id, t.ad_group_id, c.name, g.name ORDER BY SUM(t.cost) DESC LIMIT 3000`,
    [r.from, r.to]
  )
  return {
    harvest,
    waste,
    rows: rows.map(t => {
      const k = kpis(t)
      const suggestion = !t.is_exact && !t.is_negative && k.orders >= harvest ? 'harvest' : !t.is_negative && k.orders === 0 && k.clicks >= waste ? 'negate' : null
      return { term: t.search_term, campaignId: t.campaign_id, adGroupId: t.ad_group_id, campaign: t.campaign_name, adGroup: t.ad_group_name, isExact: t.is_exact, isNegative: t.is_negative, suggestion, ...k }
    }),
  }
}

export async function loadProducts(r: Range) {
  const rows = await queryMany<any>(
    `WITH cat AS (
       SELECT DISTINCT ON (COALESCE(v.sku, p.sku)) COALESCE(v.sku, p.sku) AS sku, p.name, COALESCE(v.stock_status, p.stock_status) AS stock_status,
              COALESCE(v.cost_price, p.cost_price) AS cost, COALESCE(v.price, p.base_price) AS price, COALESCE(v.price_ex_gst, p.price_ex_gst) AS price_ex_gst
       FROM products p LEFT JOIN product_variants v ON v.product_id = p.id WHERE COALESCE(v.sku, p.sku) IS NOT NULL
     )
     SELECT m.sku, max(m.asin) AS asin, cat.name, cat.stock_status, cat.cost, cat.price, cat.price_ex_gst, ${SUMS}, COALESCE(SUM(m.units),0) AS units
     FROM aads_product_metrics m LEFT JOIN cat ON cat.sku = m.sku
     WHERE m.date BETWEEN $1 AND $2 GROUP BY m.sku, cat.name, cat.stock_status, cat.cost, cat.price, cat.price_ex_gst ORDER BY SUM(m.cost) DESC LIMIT 2000`,
    [r.from, r.to]
  )
  return {
    rows: rows.map(p => {
      const k = kpis(p)
      const units = n(p.units)
      const ex = p.price && p.price_ex_gst ? n(p.price_ex_gst) / n(p.price) : 1
      const grossProfit = p.cost == null ? null : k.sales * ex - units * n(p.cost)
      return {
        sku: p.sku,
        asin: p.asin,
        name: p.name,
        stockStatus: p.stock_status,
        units,
        ...k,
        profitAfterAds: grossProfit == null ? null : Math.round((grossProfit - k.cost) * 100) / 100,
      }
    }),
  }
}

export async function loadAadsTab(tab: AadsTab, r: Range) {
  switch (tab) {
    case 'overview':
      return loadOverview(r)
    case 'campaigns':
      return loadCampaigns(r)
    case 'keywords':
      return loadKeywords(r)
    case 'searchterms':
      return loadSearchTerms(r)
    case 'products':
      return loadProducts(r)
    default:
      return {}
  }
}

// ---- Changes ----

const id = z.string().regex(/^\d{1,30}$/)
export const AadsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('campaign.state'), campaignId: id, state: z.enum(['ENABLED', 'PAUSED']) }),
  z.object({ action: z.literal('campaign.budget'), campaignId: id, budget: z.number().positive() }),
  z.object({ action: z.literal('keyword.bid'), keywordId: id, bid: z.number().positive() }),
  z.object({ action: z.literal('keyword.state'), keywordId: id, state: z.enum(['ENABLED', 'PAUSED']) }),
  z.object({
    action: z.literal('keyword.add'),
    campaignId: id,
    adGroupId: id,
    text: z.string().trim().min(1).max(80),
    matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']),
    bid: z.number().positive(),
  }),
  z.object({ action: z.literal('negative.add'), campaignId: id, adGroupId: id, text: z.string().trim().min(1).max(80), matchType: z.enum(['NEGATIVE_EXACT', 'NEGATIVE_PHRASE']) }),
])
export type AadsAction = z.infer<typeof AadsActionSchema>

export function budgetProblems(next: number, current: number | null): string[] {
  const out: string[] = []
  if (next < LIMITS.minBudget) out.push(`Amazon's minimum daily budget is ${LIMITS.minBudget}.`)
  if (next > LIMITS.maxBudget) out.push(`The daily budget cannot be above ${LIMITS.maxBudget}.`)
  if (current && next / current > LIMITS.maxJump) out.push(`That is more than ${LIMITS.maxJump}x the current budget; raise it in steps.`)
  return out
}

export function bidProblems(next: number, current: number | null): string[] {
  const out: string[] = []
  if (next < LIMITS.minBid) out.push(`Amazon's minimum bid is ${LIMITS.minBid}.`)
  if (next > LIMITS.maxBid) out.push(`Bids above ${LIMITS.maxBid} are not allowed here.`)
  if (current && next / current > LIMITS.maxJump) out.push(`That is more than ${LIMITS.maxJump}x the current bid; raise it in steps.`)
  return out
}

function check(res: any, key: string) {
  const problems = multiStatusErrors(res, key)
  if (problems.length) throw new Error(problems.join('; '))
  return res
}

export async function runAadsAction(a: AadsAction, actor: ChangeActor, preview: boolean): Promise<ChangeOutcome<unknown>> {
  const base = { channel: 'amazon_ads' as const, action: a.action }
  const ads = () => amazonAdsClient()
  switch (a.action) {
    case 'campaign.state':
    case 'campaign.budget': {
      const c = await queryOne<any>(`SELECT name, state, daily_budget FROM aads_campaigns WHERE campaign_id = $1`, [a.campaignId])
      const before = c ? { state: c.state, budget: c.daily_budget == null ? null : Number(c.daily_budget) } : null
      const after = a.action === 'campaign.state' ? { ...before, state: a.state } : { ...before, budget: a.budget }
      return runChange(
        {
          ...base,
          entityType: 'campaign',
          entityId: a.campaignId,
          summary: a.action === 'campaign.state' ? `${a.state === 'PAUSED' ? 'Paused' : 'Enabled'} campaign "${c?.name ?? a.campaignId}"` : `Set the daily budget of "${c?.name ?? a.campaignId}" to ${a.budget}`,
          before,
          after,
          validate: () => (!c ? ['Campaign not found; sync first.'] : a.action === 'campaign.budget' ? budgetProblems(a.budget, before?.budget ?? null) : []),
          apply: async () => {
            const body = a.action === 'campaign.state' ? { campaignId: a.campaignId, state: a.state } : { campaignId: a.campaignId, budget: { budget: a.budget, budgetType: 'DAILY' } }
            check(await (await ads()).request('PUT', '/sp/campaigns', { vnd: 'spCampaign', body: { campaigns: [body] } }), 'campaigns')
            await query(
              a.action === 'campaign.state' ? `UPDATE aads_campaigns SET state = $2 WHERE campaign_id = $1` : `UPDATE aads_campaigns SET daily_budget = $2 WHERE campaign_id = $1`,
              [a.campaignId, a.action === 'campaign.state' ? a.state : a.budget]
            )
          },
        },
        actor,
        preview
      )
    }
    case 'keyword.bid':
    case 'keyword.state': {
      const k = await queryOne<any>(`SELECT keyword_text, match_type, state, bid, negative FROM aads_keywords WHERE keyword_id = $1`, [a.keywordId])
      const before = k ? { state: k.state, bid: k.bid == null ? null : Number(k.bid) } : null
      const after = a.action === 'keyword.bid' ? { ...before, bid: a.bid } : { ...before, state: a.state }
      return runChange(
        {
          ...base,
          entityType: 'keyword',
          entityId: a.keywordId,
          summary: a.action === 'keyword.bid' ? `Set the bid on "${k?.keyword_text}" (${k?.match_type}) to ${a.bid}` : `${a.state === 'PAUSED' ? 'Paused' : 'Enabled'} keyword "${k?.keyword_text}"`,
          before,
          after,
          validate: () => (!k ? ['Keyword not found; sync first.'] : k.negative ? ['Negative keywords have no bid or state to change here.'] : a.action === 'keyword.bid' ? bidProblems(a.bid, before?.bid ?? null) : []),
          apply: async () => {
            const body = a.action === 'keyword.bid' ? { keywordId: a.keywordId, bid: a.bid } : { keywordId: a.keywordId, state: a.state }
            check(await (await ads()).request('PUT', '/sp/keywords', { vnd: 'spKeyword', body: { keywords: [body] } }), 'keywords')
            await query(
              a.action === 'keyword.bid' ? `UPDATE aads_keywords SET bid = $2 WHERE keyword_id = $1` : `UPDATE aads_keywords SET state = $2 WHERE keyword_id = $1`,
              [a.keywordId, a.action === 'keyword.bid' ? a.bid : a.state]
            )
          },
        },
        actor,
        preview
      )
    }
    case 'keyword.add':
    case 'negative.add': {
      const exists = await queryOne(`SELECT 1 FROM aads_keywords WHERE ad_group_id = $1 AND lower(keyword_text) = lower($2) AND match_type = $3`, [a.adGroupId, a.text, a.matchType])
      const g = await queryOne<any>(`SELECT name FROM aads_ad_groups WHERE ad_group_id = $1 AND campaign_id = $2`, [a.adGroupId, a.campaignId])
      const negative = a.action === 'negative.add'
      return runChange(
        {
          ...base,
          entityType: negative ? 'negative_keyword' : 'keyword',
          summary: `${negative ? 'Added negative' : 'Added keyword'} "${a.text}" (${a.matchType.replace('NEGATIVE_', '').toLowerCase()}) to ad group "${g?.name ?? a.adGroupId}"`,
          after: negative ? { text: a.text, matchType: a.matchType } : { text: a.text, matchType: a.matchType, bid: a.bid },
          validate: () => [...(!g ? ['Ad group not found; sync first.'] : []), ...(exists ? ['That keyword is already in this ad group.'] : []), ...(negative ? [] : bidProblems(a.bid, null))],
          apply: async () => {
            const client = await ads()
            const res = negative
              ? check(
                  await client.request('POST', '/sp/negativeKeywords', { vnd: 'spNegativeKeyword', body: { negativeKeywords: [{ campaignId: a.campaignId, adGroupId: a.adGroupId, keywordText: a.text, matchType: a.matchType, state: 'ENABLED' }] } }),
                  'negativeKeywords'
                )
              : check(
                  await client.request('POST', '/sp/keywords', { vnd: 'spKeyword', body: { keywords: [{ campaignId: a.campaignId, adGroupId: a.adGroupId, keywordText: a.text, matchType: a.matchType, state: 'ENABLED', bid: a.bid }] } }),
                  'keywords'
                )
            const created = res?.[negative ? 'negativeKeywords' : 'keywords']?.success?.[0]
            const newId = created?.negativeKeywordId ?? created?.keywordId
            if (newId) {
              await query(
                `INSERT INTO aads_keywords (keyword_id, ad_group_id, campaign_id, keyword_text, match_type, state, bid, negative) VALUES ($1,$2,$3,$4,$5,'ENABLED',$6,$7) ON CONFLICT (keyword_id) DO NOTHING`,
                [String(newId), a.adGroupId, a.campaignId, a.text, a.matchType, negative ? null : a.bid, negative]
              )
            }
            return res
          },
        },
        actor,
        preview
      )
    }
  }
}
