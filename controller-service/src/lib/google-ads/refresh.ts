import { query } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'
import { mapAd, mapAdGroup, mapCampaign, mapKeyword } from './queries'
import { bulkInsert } from './sync'

// After a change from the console, re-read just the touched entities and upsert their mirror rows,
// so the tables show the new state without waiting for the next sync. Metrics columns are kept.

export interface RefreshTarget {
  campaignIds?: string[]
  /** Ad groups, their ads and their keywords, by campaign (for a newly created campaign). */
  campaignChildren?: string[]
  adGroupIds?: string[]
  /** Re-read the ads of these ad groups. */
  adsInAdGroups?: string[]
  /** Re-read the keywords of these ad groups. */
  keywordsInAdGroups?: string[]
  recommendations?: string[]
}

const DB = { query } as unknown as Parameters<typeof bulkInsert>[0]
const ids = (list: string[] | undefined) => [...new Set((list ?? []).map(String).filter(v => /^\d+$/.test(v)))]
const inList = (list: string[]) => list.join(', ')

const CAMPAIGN_FIELDS = `campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status,
  campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type,
  campaign.start_date_time, campaign.end_date_time, campaign_budget.amount_micros, campaign_budget.period`
const AD_GROUP_FIELDS = 'ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, campaign.id'
const AD_FIELDS = `ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
  ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
  ad_group_ad.policy_summary.policy_topic_entries, ad_group.id, campaign.id`
const KEYWORD_FIELDS = `ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.quality_info.quality_score, ad_group.id, campaign.id`

export const RQ = {
  campaigns: (list: string[]) => `SELECT ${CAMPAIGN_FIELDS} FROM campaign WHERE campaign.id IN (${inList(list)})`,
  adGroupsById: (list: string[]) => `SELECT ${AD_GROUP_FIELDS} FROM ad_group WHERE ad_group.id IN (${inList(list)})`,
  adGroupsOfCampaigns: (list: string[]) =>
    `SELECT ${AD_GROUP_FIELDS} FROM ad_group WHERE campaign.id IN (${inList(list)}) AND ad_group.status != 'REMOVED'`,
  ads: (adGroups: string[]) =>
    `SELECT ${AD_FIELDS} FROM ad_group_ad WHERE ad_group.id IN (${inList(adGroups)}) AND ad_group_ad.status != 'REMOVED'`,
  keywords: (adGroups: string[]) =>
    `SELECT ${KEYWORD_FIELDS} FROM ad_group_criterion
     WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group.id IN (${inList(adGroups)}) AND ad_group_criterion.status != 'REMOVED'`,
}

const CAMPAIGN_COLS = [
  'campaign_id', 'name', 'status', 'serving_status', 'primary_status', 'channel_type', 'channel_sub_type',
  'bidding_strategy_type', 'budget_amount_micros', 'budget_period', 'start_date', 'end_date',
]
const AD_GROUP_COLS = ['ad_group_id', 'campaign_id', 'name', 'status', 'type', 'cpc_bid_micros']
const AD_COLS = ['ad_group_id', 'ad_id', 'campaign_id', 'name', 'type', 'status', 'approval_status', 'review_status', 'policy_topics', 'final_urls', 'headlines']
const KEYWORD_COLS = ['ad_group_id', 'criterion_id', 'campaign_id', 'text', 'match_type', 'status', 'negative', 'quality_score']
const set = (cols: string[]) => [...cols, 'updated_at'].map(c => `${c}=EXCLUDED.${c}`).join(', ')
const json = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : v)

async function upsertCampaigns(ads: GoogleAdsClient, list: string[]): Promise<number> {
  const rows = (await ads.searchStream(RQ.campaigns(list))).map(mapCampaign).filter(r => r.campaign_id)
  const live = rows.filter(r => r.status !== 'REMOVED')
  const gone = [...list.filter(id => !rows.some(r => r.campaign_id === id)), ...rows.filter(r => r.status === 'REMOVED').map(r => r.campaign_id!)]
  if (gone.length) await removeCampaignRows(gone)
  if (!live.length) return 0
  return bulkInsert(
    DB,
    'ads_campaigns',
    [...CAMPAIGN_COLS, 'updated_at'],
    live.map(r => [...CAMPAIGN_COLS.map(c => (r as any)[c]), new Date()]),
    `ON CONFLICT (campaign_id) DO UPDATE SET ${set(CAMPAIGN_COLS.slice(1))}`
  )
}

async function removeCampaignRows(list: string[]) {
  await query(`DELETE FROM ads_keywords WHERE campaign_id = ANY($1::bigint[])`, [list])
  await query(`DELETE FROM ads_ads WHERE campaign_id = ANY($1::bigint[])`, [list])
  await query(`DELETE FROM ads_ad_groups WHERE campaign_id = ANY($1::bigint[])`, [list])
  await query(`DELETE FROM ads_campaigns WHERE campaign_id = ANY($1::bigint[])`, [list])
}

async function upsertAdGroups(ads: GoogleAdsClient, gaql: string, expected: string[] = []): Promise<string[]> {
  const rows = (await ads.searchStream(gaql)).map(mapAdGroup).filter(r => r.ad_group_id && r.campaign_id)
  const live = rows.filter(r => r.status !== 'REMOVED')
  const gone = [...expected.filter(id => !rows.some(r => r.ad_group_id === id)), ...rows.filter(r => r.status === 'REMOVED').map(r => r.ad_group_id!)]
  if (gone.length) {
    await query(`DELETE FROM ads_keywords WHERE ad_group_id = ANY($1::bigint[])`, [gone])
    await query(`DELETE FROM ads_ads WHERE ad_group_id = ANY($1::bigint[])`, [gone])
    await query(`DELETE FROM ads_ad_groups WHERE ad_group_id = ANY($1::bigint[])`, [gone])
  }
  if (live.length) {
    await bulkInsert(
      DB,
      'ads_ad_groups',
      [...AD_GROUP_COLS, 'updated_at'],
      live.map(r => [...AD_GROUP_COLS.map(c => (r as any)[c]), new Date()]),
      `ON CONFLICT (ad_group_id) DO UPDATE SET ${set(AD_GROUP_COLS.slice(1))}`
    )
  }
  return live.map(r => r.ad_group_id!)
}

/** Replace the non-metric columns of every ad in these ad groups; ads no longer there are dropped. */
async function upsertAds(ads: GoogleAdsClient, adGroups: string[]): Promise<number> {
  const rows = (await ads.searchStream(RQ.ads(adGroups))).map(mapAd).filter(a => a.ad_id && a.ad_group_id && a.campaign_id)
  await query(
    `DELETE FROM ads_ads WHERE ad_group_id = ANY($1::bigint[]) AND NOT (ad_id = ANY($2::bigint[]))`,
    [adGroups, rows.map(r => r.ad_id)]
  )
  if (!rows.length) return 0
  return bulkInsert(
    DB,
    'ads_ads',
    [...AD_COLS, 'updated_at'],
    rows.map(r => [...AD_COLS.map(c => json((r as any)[c])), new Date()]),
    `ON CONFLICT (ad_group_id, ad_id) DO UPDATE SET ${set(AD_COLS.slice(2))}`
  )
}

async function upsertKeywords(ads: GoogleAdsClient, adGroups: string[]): Promise<number> {
  const rows = (await ads.searchStream(RQ.keywords(adGroups))).map(mapKeyword).filter(k => k.criterion_id && k.ad_group_id)
  await query(
    `DELETE FROM ads_keywords WHERE ad_group_id = ANY($1::bigint[]) AND NOT (criterion_id = ANY($2::bigint[]))`,
    [adGroups, rows.map(r => r.criterion_id)]
  )
  if (!rows.length) return 0
  return bulkInsert(
    DB,
    'ads_keywords',
    [...KEYWORD_COLS, 'updated_at'],
    rows.map(r => [...KEYWORD_COLS.map(c => (r as any)[c]), new Date()]),
    `ON CONFLICT (ad_group_id, criterion_id) DO UPDATE SET ${set(KEYWORD_COLS.slice(2))}`
  )
}

/** Returns row counts per table touched. */
export async function refreshMirror(ads: GoogleAdsClient, t: RefreshTarget): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const campaigns = ids([...(t.campaignIds ?? []), ...(t.campaignChildren ?? [])])
  if (campaigns.length) out.campaigns = await upsertCampaigns(ads, campaigns)

  const children = ids(t.campaignChildren)
  const childGroups = children.length ? await upsertAdGroups(ads, RQ.adGroupsOfCampaigns(children)) : []
  const direct = ids(t.adGroupIds)
  if (direct.length) await upsertAdGroups(ads, RQ.adGroupsById(direct), direct)
  if (childGroups.length + direct.length) out.ad_groups = childGroups.length + direct.length

  const adGroupsForAds = ids([...childGroups, ...(t.adsInAdGroups ?? [])])
  if (adGroupsForAds.length) out.ads = await upsertAds(ads, adGroupsForAds)
  const adGroupsForKeywords = ids([...childGroups, ...(t.keywordsInAdGroups ?? [])])
  if (adGroupsForKeywords.length) out.keywords = await upsertKeywords(ads, adGroupsForKeywords)

  if (t.recommendations?.length) {
    await query(`DELETE FROM ads_recommendations WHERE resource_name = ANY($1::text[])`, [t.recommendations])
    out.recommendations = t.recommendations.length
  }
  return out
}
