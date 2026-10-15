import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'
import { ExtensionsSchema, MATCH_TYPES } from './campaign-spec'
import { adGroupBidOps, biddingTargetOps, budgetOps, loadCampaignSettings, removeOps, statusOps, type EntityRef } from './campaigns'
import { adGroupKeywordOps, campaignNegativeOps } from './keywords'
import { extensionOps, hasExtensions } from './assets'
import { AdsMutationError, OpList, rn, runLoggedCall, runMutation, type AdsAction, type AdsEntity, type ChangeActor } from './mutate'
import type { RefreshTarget } from './refresh'

// One entry per edit the console offers on existing entities. Each becomes a validated mutate
// (or, for recommendations, a logged call) and refreshes the mirror rows it touched.

const id = z.string().regex(/^\d{1,20}$/, 'Invalid id')
const status = z.enum(['ENABLED', 'PAUSED'])
const kw = { text: z.string().trim().min(1).max(200), matchType: z.enum(MATCH_TYPES) }
const recommendation = z.string().regex(/^customers\/\d+\/recommendations\/[A-Za-z0-9~_\-.=+]+$/, 'Invalid recommendation')

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('campaign.status'), campaignId: id, status }),
  z.object({ action: z.literal('campaign.remove'), campaignId: id }),
  z.object({ action: z.literal('campaign.budget'), campaignId: id, dailyBudget: z.number().min(1).max(10_000_000) }),
  z.object({
    action: z.literal('campaign.bidding'),
    campaignId: id,
    targetCpa: z.number().positive().max(10_000_000).nullable().optional(),
    targetRoas: z.number().positive().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal('adgroup.status'), adGroupId: id, status }),
  z.object({ action: z.literal('adgroup.remove'), adGroupId: id }),
  z.object({ action: z.literal('adgroup.bid'), adGroupId: id, cpcBid: z.number().positive().max(1_000_000) }),
  z.object({ action: z.literal('ad.status'), adGroupId: id, adId: id, status }),
  z.object({ action: z.literal('ad.remove'), adGroupId: id, adId: id }),
  z.object({ action: z.literal('keyword.status'), adGroupId: id, criterionId: id, status }),
  z.object({ action: z.literal('keyword.remove'), adGroupId: id, criterionId: id }),
  z.object({ action: z.literal('keyword.add'), adGroupId: id, ...kw }),
  z.object({ action: z.literal('negative.add'), level: z.enum(['campaign', 'ad_group']), campaignId: id.optional(), adGroupId: id.optional(), ...kw }),
  z.object({ action: z.literal('assets.add'), campaignId: id, extensions: ExtensionsSchema }),
  z.object({ action: z.literal('recommendation.apply'), resourceName: recommendation }),
  z.object({ action: z.literal('recommendation.dismiss'), resourceName: recommendation }),
])

export type ManageAction = z.infer<typeof ActionSchema>

const VERB: Record<string, string> = { ENABLED: 'Enabled', PAUSED: 'Paused' }

async function mirrorName(sql: string, param: string): Promise<string> {
  const row = await queryOne<{ name: string }>(sql, [param]).catch(() => null)
  return row?.name ? `"${row.name}"` : param
}
const campaignName = (v: string) => mirrorName(`SELECT name FROM ads_campaigns WHERE campaign_id = $1::bigint`, v)
const adGroupName = (v: string) => mirrorName(`SELECT name FROM ads_ad_groups WHERE ad_group_id = $1::bigint`, v)

interface Plan {
  action: AdsAction
  entityType: AdsEntity
  entityId: string
  summary: string
  ops: OpList
  refresh?: RefreshTarget
}

async function plan(a: Exclude<ManageAction, { action: 'recommendation.apply' | 'recommendation.dismiss' }>, ads: GoogleAdsClient): Promise<Plan> {
  const cid = ads.customerId
  switch (a.action) {
    case 'campaign.status':
      return {
        action: a.action,
        entityType: 'campaign',
        entityId: a.campaignId,
        summary: `${VERB[a.status]} campaign ${await campaignName(a.campaignId)}`,
        ops: statusOps(cid, { kind: 'campaign', campaignId: a.campaignId }, a.status),
        refresh: { campaignIds: [a.campaignId] },
      }
    case 'campaign.remove':
      return {
        action: a.action,
        entityType: 'campaign',
        entityId: a.campaignId,
        summary: `Removed campaign ${await campaignName(a.campaignId)}`,
        ops: removeOps(cid, { kind: 'campaign', campaignId: a.campaignId }),
        refresh: { campaignIds: [a.campaignId] },
      }
    case 'campaign.budget': {
      const s = await loadCampaignSettings(ads, a.campaignId)
      if (!s) throw new AdsMutationError('Campaign not found in Google Ads', 'validate', [], 404)
      return {
        action: a.action,
        entityType: 'campaign',
        entityId: a.campaignId,
        summary: `Changed the daily budget of "${s.name}" from ${s.dailyBudget ?? '-'} to ${a.dailyBudget}${s.budgetShared ? ` (shared by ${s.budgetCampaigns} campaigns)` : ''}`,
        ops: budgetOps(s, a.dailyBudget),
        refresh: { campaignIds: [a.campaignId] },
      }
    }
    case 'campaign.bidding': {
      const s = await loadCampaignSettings(ads, a.campaignId)
      if (!s) throw new AdsMutationError('Campaign not found in Google Ads', 'validate', [], 404)
      const what = a.targetRoas !== undefined ? `target ROAS ${a.targetRoas ?? 'cleared'}` : `target CPA ${a.targetCpa ?? 'cleared'}`
      return {
        action: a.action,
        entityType: 'campaign',
        entityId: a.campaignId,
        summary: `Set ${what} on "${s.name}"`,
        ops: biddingTargetOps(cid, s, { targetCpa: a.targetCpa, targetRoas: a.targetRoas }),
        refresh: { campaignIds: [a.campaignId] },
      }
    }
    case 'adgroup.status':
      return {
        action: a.action,
        entityType: 'ad_group',
        entityId: a.adGroupId,
        summary: `${VERB[a.status]} ad group ${await adGroupName(a.adGroupId)}`,
        ops: statusOps(cid, { kind: 'ad_group', adGroupId: a.adGroupId }, a.status),
        refresh: { adGroupIds: [a.adGroupId] },
      }
    case 'adgroup.remove':
      return {
        action: a.action,
        entityType: 'ad_group',
        entityId: a.adGroupId,
        summary: `Removed ad group ${await adGroupName(a.adGroupId)}`,
        ops: removeOps(cid, { kind: 'ad_group', adGroupId: a.adGroupId }),
        refresh: { adGroupIds: [a.adGroupId] },
      }
    case 'adgroup.bid':
      return {
        action: a.action,
        entityType: 'ad_group',
        entityId: a.adGroupId,
        summary: `Set max CPC ${a.cpcBid} on ad group ${await adGroupName(a.adGroupId)}`,
        ops: adGroupBidOps(cid, a.adGroupId, a.cpcBid),
        refresh: { adGroupIds: [a.adGroupId] },
      }
    case 'ad.status':
      return {
        action: a.action,
        entityType: 'ad',
        entityId: `${a.adGroupId}~${a.adId}`,
        summary: `${VERB[a.status]} ad ${a.adId} in ad group ${await adGroupName(a.adGroupId)}`,
        ops: statusOps(cid, { kind: 'ad', adGroupId: a.adGroupId, adId: a.adId }, a.status),
        refresh: { adsInAdGroups: [a.adGroupId] },
      }
    case 'ad.remove':
      return {
        action: a.action,
        entityType: 'ad',
        entityId: `${a.adGroupId}~${a.adId}`,
        summary: `Removed ad ${a.adId} from ad group ${await adGroupName(a.adGroupId)}`,
        ops: removeOps(cid, { kind: 'ad', adGroupId: a.adGroupId, adId: a.adId }),
        refresh: { adsInAdGroups: [a.adGroupId] },
      }
    case 'keyword.status':
    case 'keyword.remove': {
      const row = await queryOne<{ text: string }>(
        `SELECT text FROM ads_keywords WHERE ad_group_id = $1::bigint AND criterion_id = $2::bigint`,
        [a.adGroupId, a.criterionId]
      ).catch(() => null)
      const name = row?.text ? `"${row.text}"` : a.criterionId
      const ref: EntityRef = { kind: 'keyword', adGroupId: a.adGroupId, criterionId: a.criterionId }
      return {
        action: a.action,
        entityType: 'keyword',
        entityId: `${a.adGroupId}~${a.criterionId}`,
        summary: a.action === 'keyword.remove' ? `Removed keyword ${name}` : `${VERB[a.status]} keyword ${name}`,
        ops: a.action === 'keyword.remove' ? removeOps(cid, ref) : statusOps(cid, ref, a.status),
        refresh: { keywordsInAdGroups: [a.adGroupId] },
      }
    }
    case 'keyword.add':
      return {
        action: a.action,
        entityType: 'keyword',
        entityId: a.adGroupId,
        summary: `Added ${a.matchType.toLowerCase()} keyword "${a.text}" to ad group ${await adGroupName(a.adGroupId)}`,
        ops: adGroupKeywordOps(rn.adGroup(cid, a.adGroupId), [{ text: a.text, matchType: a.matchType }]),
        refresh: { keywordsInAdGroups: [a.adGroupId] },
      }
    case 'negative.add': {
      if (a.level === 'campaign') {
        if (!a.campaignId) throw new AdsMutationError('Pick the campaign for the negative keyword', 'validate', [], 400)
        return {
          action: a.action,
          entityType: 'keyword',
          entityId: a.campaignId,
          summary: `Added negative keyword "${a.text}" (${a.matchType.toLowerCase()}) to campaign ${await campaignName(a.campaignId)}`,
          ops: campaignNegativeOps(rn.campaign(cid, a.campaignId), [{ text: a.text, matchType: a.matchType }]),
        }
      }
      if (!a.adGroupId) throw new AdsMutationError('Pick the ad group for the negative keyword', 'validate', [], 400)
      return {
        action: a.action,
        entityType: 'keyword',
        entityId: a.adGroupId,
        summary: `Added negative keyword "${a.text}" (${a.matchType.toLowerCase()}) to ad group ${await adGroupName(a.adGroupId)}`,
        ops: adGroupKeywordOps(rn.adGroup(cid, a.adGroupId), [{ text: a.text, matchType: a.matchType }], { negative: true }),
        refresh: { keywordsInAdGroups: [a.adGroupId] },
      }
    }
    case 'assets.add': {
      if (!hasExtensions(a.extensions)) throw new AdsMutationError('Pick at least one asset to add', 'validate', [], 400)
      const currency = (await queryOne<{ c: string }>(`SELECT currency_code AS c FROM ads_account WHERE id = 1`).catch(() => null))?.c
      const x = a.extensions
      const counts = [
        x.sitelinks.length && `${x.sitelinks.length} sitelinks`,
        x.callouts.length && `${x.callouts.length} callouts`,
        x.snippets.length && `${x.snippets.length} snippets`,
        x.promotions.length && `${x.promotions.length} promotions`,
        x.prices.length && `${x.prices.length} price lists`,
      ].filter(Boolean)
      return {
        action: a.action,
        entityType: 'asset',
        entityId: a.campaignId,
        summary: `Added ${counts.join(', ')} to campaign ${await campaignName(a.campaignId)}`,
        ops: extensionOps(cid, rn.campaign(cid, a.campaignId), x, { currency: currency || 'INR' }),
      }
    }
  }
}

export interface ActionResult {
  ok: true
  preview: boolean
  summary: string
  resourceNames: string[]
  refreshError: string | null
}

export async function runAction(a: ManageAction, ads: GoogleAdsClient, actor: ChangeActor, preview = false): Promise<ActionResult> {
  if (a.action === 'recommendation.apply' || a.action === 'recommendation.dismiss') {
    if (!a.resourceName.startsWith(`customers/${ads.customerId}/`)) {
      throw new AdsMutationError('That recommendation belongs to another account', 'validate', [], 400)
    }
    const apply = a.action === 'recommendation.apply'
    const rec = await queryOne<{ type: string | null; campaign_id: string | null }>(
      `SELECT type, campaign_id FROM ads_recommendations WHERE resource_name = $1`,
      [a.resourceName]
    ).catch(() => null)
    const summary = `${apply ? 'Applied' : 'Dismissed'} recommendation ${rec?.type ?? a.resourceName}`
    // RecommendationService has no validateOnly; the console confirms before calling.
    if (preview) return { ok: true, preview, summary, resourceNames: [], refreshError: null }
    const { value, refreshError } = await runLoggedCall(
      { action: a.action, entityType: 'recommendation', entityId: a.resourceName, summary, request: { resourceName: a.resourceName } },
      actor,
      () => ads.post<any>(apply ? '/recommendations:apply' : '/recommendations:dismiss', { operations: [{ resourceName: a.resourceName }], partialFailure: false }),
      {
        client: ads,
        result: r => ({ resourceNames: (r?.results ?? []).map((x: any) => x?.resourceName).filter(Boolean) }),
        refresh: () => ({ recommendations: [a.resourceName], campaignIds: rec?.campaign_id && apply ? [String(rec.campaign_id)] : [] }),
      }
    )
    return { ok: true, preview, summary, resourceNames: (value?.results ?? []).map((x: any) => x?.resourceName).filter(Boolean), refreshError }
  }
  const p = await plan(a, ads)
  const outcome = await runMutation(
    { action: p.action, entityType: p.entityType, entityId: p.entityId, summary: p.summary, operations: p.ops.operations, labels: p.ops.labels, request: requestOf(a), refresh: p.refresh },
    actor,
    { client: ads, preview }
  )
  return { ok: true, preview, summary: p.summary, resourceNames: outcome.resourceNames, refreshError: outcome.refreshError }
}

/** The action as logged: no free text beyond what identifies the change. */
function requestOf(a: ManageAction): Record<string, unknown> {
  if (a.action !== 'assets.add') return { ...a }
  return {
    action: a.action,
    campaignId: a.campaignId,
    sitelinks: a.extensions.sitelinks.map(s => s.linkText),
    callouts: a.extensions.callouts,
    promotions: a.extensions.promotions.map(p => p.target),
    prices: a.extensions.prices.length,
    snippets: a.extensions.snippets.map(s => s.header),
  }
}
