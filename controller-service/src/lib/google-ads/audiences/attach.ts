import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { normalizeCustomerId, type GoogleAdsClient } from '../client'
import { AdsMutationError, OpList, TempIds, rn, type AdsAction, type AdsEntity } from '../mutate'
import type { RefreshTarget } from '../refresh'
import { SEGMENTS, SEGMENT_DEFS, type Segment } from './segments'

// Using a Customer Match list in a campaign: an audience signal on a Performance Max asset group
// (an ASSET_GROUP-scoped Audience holding the list), or a campaign criterion on Search / Shopping
// as observation, targeting or exclusion. The API defaults an audience criterion to targeting
// (bid_only false), which would narrow a Search campaign to list members only, so the campaign's
// AUDIENCE target restriction is always written explicitly.

export const ATTACH_MODES = ['observation', 'targeting', 'exclusion', 'signal'] as const
export type AttachMode = (typeof ATTACH_MODES)[number]

const id = z.string().regex(/^\d{1,20}$/, 'Invalid id')

export const AudienceAttachSchema = z.object({
  action: z.literal('audience.attach'),
  segment: z.enum(SEGMENTS),
  campaignId: id,
  mode: z.enum(ATTACH_MODES),
  assetGroupId: id.optional(),
})
export type AudienceAttach = z.infer<typeof AudienceAttachSchema>

export interface AttachPlan {
  action: AdsAction
  entityType: AdsEntity
  entityId: string
  summary: string
  ops: OpList
  refresh?: RefreshTarget
}

const MODE_LABEL: Record<AttachMode, string> = {
  observation: 'observation',
  targeting: 'targeting',
  exclusion: 'exclusion',
  signal: 'audience signal',
}

/** The campaign's target restrictions with AUDIENCE set to bid-only (observation) or not. */
export function withAudienceRestriction(current: { targetingDimension?: string; bidOnly?: boolean }[], bidOnly: boolean) {
  const others = current.filter(r => r.targetingDimension && r.targetingDimension !== 'AUDIENCE')
  return [...others.map(r => ({ targetingDimension: r.targetingDimension, bidOnly: !!r.bidOnly })), { targetingDimension: 'AUDIENCE', bidOnly }]
}

export async function audienceAttachPlan(a: AudienceAttach, ads: GoogleAdsClient): Promise<AttachPlan> {
  const cid = ads.customerId
  const list = await queryOne<{ user_list: string | null; customer_id: string | null }>(
    `SELECT user_list, customer_id::text FROM ads_audiences WHERE segment = $1`,
    [a.segment]
  ).catch(() => null)
  if (!list?.user_list || normalizeCustomerId(list.customer_id) !== cid) {
    throw new AdsMutationError('This list is not in Google Ads yet. Turn it on and refresh it first.', 'validate', [], 400)
  }
  const camp = await queryOne<{ name: string; channel_type: string | null }>(
    `SELECT name, channel_type FROM ads_campaigns WHERE campaign_id = $1::bigint`,
    [a.campaignId]
  ).catch(() => null)
  if (!camp) throw new AdsMutationError('Campaign not found. Sync Google Ads and try again.', 'validate', [], 404)
  const label = SEGMENT_DEFS[a.segment as Segment].label
  const campaign = rn.campaign(cid, a.campaignId)
  const ops = new OpList()
  const userList = { userList: list.user_list }

  if (camp.channel_type === 'PERFORMANCE_MAX') {
    if (a.mode !== 'signal') throw new AdsMutationError('Performance Max uses lists as audience signals on an asset group.', 'validate', [], 400)
    if (!a.assetGroupId) throw new AdsMutationError('Pick the asset group for the signal', 'validate', [], 400)
    const assetGroup = rn.assetGroup(cid, a.assetGroupId)
    const audience = `customers/${cid}/audiences/${new TempIds().next()}`
    ops.create(
      'audienceOperation',
      { resourceName: audience, scope: 'ASSET_GROUP', assetGroup, dimensions: [{ audienceSegments: { segments: [{ userList }] } }] },
      `Audience for ${label}`
    )
    ops.create('assetGroupSignalOperation', { assetGroup, audience: { audience } }, `Signal on asset group ${a.assetGroupId}`)
    return {
      action: 'audience.attach',
      entityType: 'audience',
      entityId: a.segment,
      summary: `Added "${label}" as an audience signal to asset group ${a.assetGroupId} of "${camp.name}"`,
      ops,
    }
  }

  if (camp.channel_type !== 'SEARCH' && camp.channel_type !== 'SHOPPING') {
    throw new AdsMutationError('Customer lists can be added to Search, Shopping and Performance Max campaigns here.', 'validate', [], 400)
  }
  if (a.mode === 'signal') throw new AdsMutationError('Audience signals are for Performance Max. Use observation or targeting.', 'validate', [], 400)

  if (a.mode === 'exclusion') {
    ops.create('campaignCriterionOperation', { campaign, negative: true, userList }, `Exclude ${label}`)
  } else {
    const rows = await ads.searchStream(`SELECT campaign.targeting_setting.target_restrictions FROM campaign WHERE campaign.id = ${a.campaignId}`)
    const current = rows[0]?.campaign?.targetingSetting?.targetRestrictions ?? []
    ops.create('campaignCriterionOperation', { campaign, userList }, `Add ${label}`)
    ops.add(
      'campaignOperation',
      {
        update: { resourceName: campaign, targetingSetting: { targetRestrictions: withAudienceRestriction(current, a.mode === 'observation') } },
        updateMask: 'targeting_setting.target_restrictions',
      },
      `Audience setting (${MODE_LABEL[a.mode]})`
    )
  }
  return {
    action: 'audience.attach',
    entityType: 'audience',
    entityId: a.segment,
    summary: `Added "${label}" to "${camp.name}" as ${MODE_LABEL[a.mode]}`,
    ops,
    refresh: { campaignIds: [a.campaignId] },
  }
}

/** Live asset groups of a Performance Max campaign, for the signal picker. */
export async function listAssetGroups(ads: GoogleAdsClient, campaignId: string): Promise<{ assetGroupId: string; name: string; status: string | null }[]> {
  if (!/^\d{1,20}$/.test(campaignId)) return []
  const rows = await ads.searchStream(
    `SELECT asset_group.id, asset_group.name, asset_group.status FROM asset_group
     WHERE campaign.id = ${campaignId} AND asset_group.status != 'REMOVED'`
  )
  return rows.map(r => ({ assetGroupId: String(r.assetGroup?.id ?? ''), name: String(r.assetGroup?.name ?? ''), status: r.assetGroup?.status ?? null })).filter(g => g.assetGroupId)
}
