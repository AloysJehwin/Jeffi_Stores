import type { GoogleAdsClient } from './client'
import { googleAdsClientFor } from './credentials'
import type { CampaignSpec } from './campaign-spec'
import { FEED_TYPES, IMAGE_AD_TYPES, filled, usesLanguageCriteria } from './campaign-spec'
import { cleanAdText } from './limits'
import {
  AdsMutationError,
  OpList,
  TempIds,
  endDateTime,
  idFrom,
  rn,
  runMutation,
  startDateTime,
  toMicros,
  type ChangeActor,
  type MutationOutcome,
  type OperationKey,
} from './mutate'
import { adGroupKeywordOps, campaignNegativeOps } from './keywords'
import { extensionOps, hasExtensions, type PreparedImages } from './assets'
import { assetGroupOps } from './pmax'
import { imageAdOps } from './image-ads'
import { pmaxTreeOps, shoppingTreeOps, type ListingTree } from './listing'

// Campaign creation for Search, Standard Shopping, Performance Max, Demand Gen and Display in one googleAds:mutate with
// temp ids, plus the edits the console offers on existing campaigns. Subdivided product groups and
// device bid adjustments need real ids, so they go in a second validated mutate right after; if
// that one fails the new campaign is removed again.

export const EU_POLITICAL = { containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' }

export function biddingFields(b: CampaignSpec['bidding']): Record<string, any> {
  switch (b.strategy) {
    case 'MAXIMIZE_CONVERSIONS':
      return { maximizeConversions: b.targetCpa ? { targetCpaMicros: toMicros(b.targetCpa) } : {} }
    case 'MAXIMIZE_CONVERSION_VALUE':
      return { maximizeConversionValue: b.targetRoas ? { targetRoas: b.targetRoas } : {} }
    case 'MANUAL_CPC':
      return { manualCpc: {} }
    case 'MAXIMIZE_CLICKS':
      return { targetSpend: {} }
  }
}

export interface DeviceAdjustments {
  mobile?: number | null
  desktop?: number | null
  tablet?: number | null
}

export interface BuildContext {
  customerId: string
  merchantId?: string | null
  feedLabel?: string
  currency?: string
  images?: PreparedImages | null
  /** Product groups with categories already resolved to item ids. */
  listing?: ListingTree | null
  /** Makes budget and image asset names unique. */
  stamp?: string
}

export interface CampaignBuild {
  ops: OpList
  campaignTempId: number
  budgetTempId: number
  /** Index of the ad group (Shopping) or asset group (PMax) create, for the follow-up tree. */
  parentOpIndex: number | null
  /** Product groups that need the real parent id (a second mutate). */
  tree: ListingTree | null
  devices: DeviceAdjustments | null
}

const hasDevices = (d: DeviceAdjustments | undefined | null) => !!d && [d.mobile, d.desktop, d.tablet].some(v => v != null && v !== 0)

export function buildCampaign(spec: CampaignSpec, ctx: BuildContext): CampaignBuild {
  const cid = ctx.customerId
  const ids = new TempIds()
  const ops = new OpList()
  const stamp = ctx.stamp ?? Date.now().toString(36)
  const budgetTempId = ids.next()
  const campaignTempId = ids.next()
  const budget = rn.budget(cid, budgetTempId)
  const campaign = rn.campaign(cid, campaignTempId)
  const manual = spec.bidding.strategy === 'MANUAL_CPC'
  const feed = { merchantId: ctx.merchantId ?? undefined, feedLabel: ctx.feedLabel ?? 'IN' }
  if (FEED_TYPES.includes(spec.type) && !ctx.merchantId) throw new AdsMutationError('Link a Merchant Center account first', 'validate', [], 400)

  ops.create(
    'campaignBudgetOperation',
    {
      resourceName: budget,
      name: `${spec.name} budget ${stamp}`.slice(0, 255),
      amountMicros: toMicros(spec.dailyBudget),
      deliveryMethod: 'STANDARD',
      explicitlyShared: false,
    },
    'Budget'
  )

  const typeFields: Record<string, any> =
    spec.type === 'SEARCH'
      ? {
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: !!spec.networks?.searchPartners,
            targetContentNetwork: !!spec.networks?.display,
            targetPartnerSearchNetwork: false,
          },
        }
      : spec.type === 'SHOPPING'
        ? {
            networkSettings: { targetGoogleSearch: true, targetSearchNetwork: !!spec.networks?.searchPartners, targetContentNetwork: false },
            shoppingSetting: { ...feed, campaignPriority: 0, enableLocal: false },
          }
        : spec.type === 'PERFORMANCE_MAX'
          ? { shoppingSetting: feed, brandGuidelinesEnabled: true }
          : {}
  const demandGen = spec.type === 'DEMAND_GEN'

  ops.create(
    'campaignOperation',
    {
      resourceName: campaign,
      name: spec.name,
      status: spec.status,
      advertisingChannelType: spec.type,
      campaignBudget: budget,
      ...EU_POLITICAL,
      ...(demandGen ? {} : { geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' } }),
      ...(spec.startDate ? { startDateTime: startDateTime(spec.startDate) } : {}),
      ...(spec.endDate ? { endDateTime: endDateTime(spec.endDate) } : {}),
      ...biddingFields(spec.bidding),
      ...typeFields,
    },
    `Campaign ${spec.name}`
  )

  // Demand Gen targets locations and languages on the ad group (imageAdOps).
  for (const l of demandGen ? [] : spec.locations) ops.create('campaignCriterionOperation', { campaign, location: { geoTargetConstant: l.id } }, `Location ${l.name}`)
  for (const l of demandGen ? [] : spec.excludedLocations ?? []) {
    ops.create('campaignCriterionOperation', { campaign, negative: true, location: { geoTargetConstant: l.id } }, `Excluded location ${l.name}`)
  }
  if (usesLanguageCriteria(spec.type) && !demandGen) {
    for (const lang of spec.languages) ops.create('campaignCriterionOperation', { campaign, language: { languageConstant: lang } }, `Language ${lang}`)
  }
  if (spec.schedule) {
    for (const day of spec.schedule.days) {
      ops.create(
        'campaignCriterionOperation',
        {
          campaign,
          adSchedule: { dayOfWeek: day, startHour: spec.schedule.startHour, startMinute: 'ZERO', endHour: spec.schedule.endHour, endMinute: 'ZERO' },
        },
        `Ad schedule ${day}`
      )
    }
  }
  if (spec.type !== 'PERFORMANCE_MAX' && !demandGen && spec.campaignNegatives?.length) campaignNegativeOps(campaign, spec.campaignNegatives, ops)

  let parentOpIndex: number | null = null
  let tree: ListingTree | null = null
  const listing = ctx.listing ?? { dimension: 'ALL', values: [] }

  if (spec.type === 'SEARCH') {
    for (const g of spec.adGroups ?? []) {
      const adGroup = rn.adGroup(cid, ids.next())
      const cpc = g.cpcBid || spec.defaultCpc
      ops.create(
        'adGroupOperation',
        { resourceName: adGroup, campaign, name: g.name, status: 'ENABLED', type: 'SEARCH_STANDARD', ...(manual && cpc ? { cpcBidMicros: toMicros(cpc) } : {}) },
        `Ad group ${g.name}`
      )
      adGroupKeywordOps(adGroup, g.keywords, { ops, label: `Ad group ${g.name}` })
      if (g.negatives?.length) adGroupKeywordOps(adGroup, g.negatives, { ops, negative: true, label: `Ad group ${g.name}` })
      ops.create(
        'adGroupAdOperation',
        {
          adGroup,
          status: 'ENABLED',
          ad: {
            finalUrls: [g.ad.finalUrl],
            responsiveSearchAd: {
              headlines: filled(g.ad.headlines).map(text => ({ text: cleanAdText(text, { headline: true }) })),
              descriptions: filled(g.ad.descriptions).map(text => ({ text: cleanAdText(text) })),
              ...(g.ad.path1?.trim() ? { path1: g.ad.path1.trim() } : {}),
              ...(g.ad.path2?.trim() ? { path2: g.ad.path2.trim() } : {}),
            },
          },
        },
        `Ad group ${g.name}: responsive search ad`
      )
    }
  } else if (spec.type === 'SHOPPING') {
    const adGroupTempId = ids.next()
    const adGroup = rn.adGroup(cid, adGroupTempId)
    parentOpIndex = ops.operations.length
    ops.create(
      'adGroupOperation',
      {
        resourceName: adGroup,
        campaign,
        name: `${spec.name} products`.slice(0, 255),
        status: 'ENABLED',
        type: 'SHOPPING_PRODUCT_ADS',
        ...(manual && spec.defaultCpc ? { cpcBidMicros: toMicros(spec.defaultCpc) } : {}),
      },
      'Product ad group'
    )
    ops.create('adGroupAdOperation', { adGroup, status: 'ENABLED', ad: { shoppingProductAd: {} } }, 'Product ad')
    if (listing.dimension === 'ALL') {
      const root = shoppingTreeOps(cid, String(adGroupTempId), listing, { cpcBid: manual ? spec.defaultCpc : null })
      root.operations.forEach((o, i) => ops.add(Object.keys(o)[0] as OperationKey, Object.values(o)[0]!, root.labels[i]))
    } else tree = listing
  } else if (IMAGE_AD_TYPES.includes(spec.type) && spec.imageAd) {
    imageAdOps(cid, campaign, spec, { ids, ops, images: ctx.images, stamp })
  } else if (spec.type === 'PERFORMANCE_MAX' && spec.assetGroup) {
    const before = ops.operations.length
    const { assetGroupTempId } = assetGroupOps(cid, campaign, spec.assetGroup, { ids, ops, images: ctx.images, stamp })
    parentOpIndex = ops.operations.findIndex((o, i) => i >= before && !!o.assetGroupOperation)
    if (listing.dimension === 'ALL') {
      const root = pmaxTreeOps(cid, String(assetGroupTempId), listing)
      root.operations.forEach((o, i) => ops.add(Object.keys(o)[0] as OperationKey, Object.values(o)[0]!, root.labels[i]))
    } else tree = listing
  }

  if (hasExtensions(spec.extensions)) extensionOps(cid, campaign, spec.extensions!, { ids, ops, currency: ctx.currency })

  return {
    ops,
    campaignTempId,
    budgetTempId,
    parentOpIndex,
    tree,
    devices: spec.type !== 'PERFORMANCE_MAX' && !demandGen && hasDevices(spec.devices) ? spec.devices! : null,
  }
}

/** The request in brief for the change log (no image data, no copy). */
export function summarizeSpec(spec: CampaignSpec, listing?: ListingTree | null): Record<string, unknown> {
  return {
    type: spec.type,
    name: spec.name,
    dailyBudget: spec.dailyBudget,
    bidding: spec.bidding,
    status: spec.status,
    dates: [spec.startDate ?? null, spec.endDate ?? null],
    locations: spec.locations.map(l => l.name),
    languages: spec.languages.length,
    adGroups: (spec.adGroups ?? []).map(g => ({ name: g.name, keywords: g.keywords.length, headlines: filled(g.ad.headlines).length })),
    listing: listing ? { dimension: listing.dimension, values: listing.values.length } : undefined,
    assetGroup: spec.assetGroup
      ? { feedOnly: spec.assetGroup.feedOnly, headlines: filled(spec.assetGroup.headlines).length, images: spec.assetGroup.imageIds.length }
      : undefined,
    imageAd: spec.imageAd
      ? { headlines: filled(spec.imageAd.headlines).length, images: spec.imageAd.imageIds.length, audiences: spec.imageAd.audiences.length, channels: spec.imageAd.channels }
      : undefined,
    extensions: spec.extensions
      ? {
          sitelinks: spec.extensions.sitelinks.length,
          callouts: spec.extensions.callouts.length,
          promotions: spec.extensions.promotions.length,
          prices: spec.extensions.prices.length,
          snippets: spec.extensions.snippets.length,
        }
      : undefined,
  }
}

const DEVICE_TYPES: Record<keyof DeviceAdjustments, string> = { mobile: 'MOBILE', desktop: 'DESKTOP', tablet: 'TABLET' }

/** Percent adjustment to a bid modifier: +20 -> 1.2, -100 -> 0 (device excluded). */
export function deviceModifier(pct: number): number {
  if (pct <= -100) return 0
  return Math.min(10, Math.max(0.1, Math.round((1 + pct / 100) * 100) / 100))
}

/** Device criteria exist on most campaigns already; update those, create the rest. */
export async function deviceOps(ads: GoogleAdsClient, customerId: string, campaignId: string, d: DeviceAdjustments): Promise<OpList> {
  if (!/^\d+$/.test(campaignId)) throw new Error('Invalid campaign id')
  const rows = await ads.searchStream(
    `SELECT campaign_criterion.criterion_id, campaign_criterion.device.type FROM campaign_criterion
     WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'DEVICE'`
  )
  const existing = new Map<string, string>()
  for (const r of rows) {
    const type = r.campaignCriterion?.device?.type
    if (type && r.campaignCriterion?.criterionId) existing.set(type, String(r.campaignCriterion.criterionId))
  }
  const ops = new OpList()
  for (const [key, type] of Object.entries(DEVICE_TYPES) as [keyof DeviceAdjustments, string][]) {
    const pct = d[key]
    if (pct == null) continue
    const bidModifier = deviceModifier(pct)
    const critId = existing.get(type)
    if (critId) {
      ops.add(
        'campaignCriterionOperation',
        { update: { resourceName: rn.campaignCriterion(customerId, campaignId, critId), bidModifier }, updateMask: 'bid_modifier' },
        `${type.toLowerCase()} bid adjustment`
      )
    } else {
      ops.create('campaignCriterionOperation', { campaign: rn.campaign(customerId, campaignId), device: { type }, bidModifier }, `${type.toLowerCase()} bid adjustment`)
    }
  }
  return ops
}

/** Existing listing group filters of an asset group, leaves first (removal order). */
async function existingFilterRemovals(ads: GoogleAdsClient, assetGroupId: string): Promise<OpList> {
  digits(assetGroupId)
  const rows = await ads.searchStream(
    `SELECT asset_group_listing_group_filter.resource_name, asset_group_listing_group_filter.parent_listing_group_filter
     FROM asset_group_listing_group_filter
     WHERE asset_group_listing_group_filter.asset_group = '${rn.assetGroup(ads.customerId, assetGroupId)}'`
  )
  const parents = new Set(rows.map(r => r.assetGroupListingGroupFilter?.parentListingGroupFilter).filter(Boolean))
  const ordered = [...rows].sort((a, b) => {
    const leafA = parents.has(a.assetGroupListingGroupFilter?.resourceName) ? 1 : 0
    const leafB = parents.has(b.assetGroupListingGroupFilter?.resourceName) ? 1 : 0
    return leafA - leafB
  })
  const ops = new OpList()
  for (const r of ordered) {
    const name = r.assetGroupListingGroupFilter?.resourceName
    if (name) ops.add('assetGroupListingGroupFilterOperation', { remove: name }, 'Previous product groups')
  }
  return ops
}

export interface CreateResult {
  campaignId: string
  resourceNames: string[]
  steps: { action: string; ok: boolean; message?: string }[]
  refreshError: string | null
}

export interface CreatePreview {
  operations: Record<string, number>
  followUps: string[]
}

/**
 * Validate (preview) or create a campaign. On create, the follow-up product groups / device
 * adjustments run as their own validated mutate; when Google rejects them the campaign is removed.
 */
export async function createCampaign(
  spec: CampaignSpec,
  ctx: BuildContext,
  actor: ChangeActor,
  opts: { client?: GoogleAdsClient; preview?: boolean } = {}
): Promise<CreatePreview | CreateResult> {
  const ads = opts.client ?? (await googleAdsClientFor())
  const build = buildCampaign(spec, { ...ctx, customerId: ads.customerId || ctx.customerId })
  const cid = ads.customerId || ctx.customerId
  const followUps = [
    ...(build.tree ? [`Product groups by ${build.tree.dimension.toLowerCase()} (${build.tree.values.length})`] : []),
    ...(build.devices ? ['Device bid adjustments'] : []),
  ]
  const plan = {
    action: 'campaign.create' as const,
    entityType: 'campaign' as const,
    entityId: null,
    summary: `Created ${spec.type.replace('_', ' ').toLowerCase()} campaign "${spec.name}"`,
    operations: build.ops.operations,
    labels: build.ops.labels,
    request: summarizeSpec(spec, ctx.listing),
    refresh: (names: string[]) => ({ campaignChildren: [idFrom(names.find(n => n.includes('/campaigns/')))] }),
  }
  if (opts.preview) {
    await runMutation(plan, actor, { client: ads, preview: true })
    return { operations: build.ops.counts(), followUps }
  }

  const created: MutationOutcome = await runMutation(plan, actor, { client: ads })
  const campaignId = idFrom(created.resourceNames.find(n => n.includes('/campaigns/')))
  const steps: CreateResult['steps'] = [{ action: 'campaign.create', ok: true }]
  try {
    if (build.tree && build.parentOpIndex != null) {
      const parentId = idFrom(created.resourceNames[build.parentOpIndex])
      const treeOps =
        spec.type === 'SHOPPING'
          ? shoppingTreeOps(cid, parentId, build.tree, { cpcBid: spec.bidding.strategy === 'MANUAL_CPC' ? spec.defaultCpc : null })
          : await (async () => {
              const ops = await existingFilterRemovals(ads, parentId)
              const tree = pmaxTreeOps(cid, parentId, build.tree!)
              tree.operations.forEach((o, i) => ops.add(Object.keys(o)[0] as OperationKey, Object.values(o)[0]!, tree.labels[i]))
              return ops
            })()
      await runMutation(
        {
          action: 'campaign.listing_groups',
          entityType: 'campaign',
          entityId: campaignId,
          summary: `Set product groups on "${spec.name}"`,
          operations: treeOps.operations,
          labels: treeOps.labels,
          request: { dimension: build.tree.dimension, values: build.tree.values.length },
        },
        actor,
        { client: ads }
      )
      steps.push({ action: 'campaign.listing_groups', ok: true })
    }
    if (build.devices) {
      const dOps = await deviceOps(ads, cid, campaignId, build.devices)
      if (dOps.operations.length) {
        await runMutation(
          {
            action: 'campaign.devices',
            entityType: 'campaign',
            entityId: campaignId,
            summary: `Set device bid adjustments on "${spec.name}"`,
            operations: dOps.operations,
            labels: dOps.labels,
            request: { ...build.devices },
          },
          actor,
          { client: ads }
        )
      }
      steps.push({ action: 'campaign.devices', ok: true })
    }
  } catch (e) {
    const err = e instanceof AdsMutationError ? e : new AdsMutationError(String((e as any)?.message ?? e), 'commit', [], 500)
    await runMutation(
      {
        action: 'campaign.remove',
        entityType: 'campaign',
        entityId: campaignId,
        summary: `Removed "${spec.name}" again: ${err.message}`.slice(0, 500),
        operations: [
          { campaignOperation: { remove: rn.campaign(cid, campaignId) } },
          { campaignBudgetOperation: { remove: created.resourceNames[0] } },
        ],
        labels: ['Campaign', 'Budget'],
        refresh: { campaignIds: [campaignId] },
      },
      actor,
      { client: ads }
    ).catch(() => {})
    err.message = `Google rejected the follow-up step (${err.message}), so the new campaign was removed again.`
    throw err
  }
  return { campaignId, resourceNames: created.resourceNames, steps, refreshError: created.refreshError }
}

// ── Edits on existing entities ──────────────────────────────────────────────

export type EntityRef =
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'ad_group'; adGroupId: string }
  | { kind: 'ad'; adGroupId: string; adId: string }
  | { kind: 'keyword'; adGroupId: string; criterionId: string }

const digits = (...v: string[]) => {
  if (!v.every(x => /^\d+$/.test(x))) throw new AdsMutationError('Invalid id', 'validate', [], 400)
}

export function entityResource(cid: string, ref: EntityRef): { key: OperationKey; name: string } {
  switch (ref.kind) {
    case 'campaign':
      digits(ref.campaignId)
      return { key: 'campaignOperation', name: rn.campaign(cid, ref.campaignId) }
    case 'ad_group':
      digits(ref.adGroupId)
      return { key: 'adGroupOperation', name: rn.adGroup(cid, ref.adGroupId) }
    case 'ad':
      digits(ref.adGroupId, ref.adId)
      return { key: 'adGroupAdOperation', name: rn.adGroupAd(cid, ref.adGroupId, ref.adId) }
    case 'keyword':
      digits(ref.adGroupId, ref.criterionId)
      return { key: 'adGroupCriterionOperation', name: rn.adGroupCriterion(cid, ref.adGroupId, ref.criterionId) }
  }
}

export function statusOps(cid: string, ref: EntityRef, status: 'ENABLED' | 'PAUSED'): OpList {
  const { key, name } = entityResource(cid, ref)
  return new OpList().add(key, { update: { resourceName: name, status }, updateMask: 'status' }, `${ref.kind.replace('_', ' ')} status`)
}

export function removeOps(cid: string, ref: EntityRef): OpList {
  const { key, name } = entityResource(cid, ref)
  return new OpList().add(key, { remove: name }, `Remove ${ref.kind.replace('_', ' ')}`)
}

export function adGroupBidOps(cid: string, adGroupId: string, cpc: number): OpList {
  digits(adGroupId)
  return new OpList().add(
    'adGroupOperation',
    { update: { resourceName: rn.adGroup(cid, adGroupId), cpcBidMicros: toMicros(cpc) }, updateMask: 'cpc_bid_micros' },
    'Ad group max CPC'
  )
}

export interface CampaignSettings {
  campaignId: string
  name: string
  status: string | null
  channelType: string | null
  biddingStrategyType: string | null
  /** A shared (portfolio) bid strategy: targets are edited on the strategy, not here. */
  portfolio: boolean
  targetCpa: number | null
  targetRoas: number | null
  budgetResource: string | null
  dailyBudget: number | null
  budgetShared: boolean
  budgetCampaigns: number
  startDate: string | null
  endDate: string | null
}

export async function loadCampaignSettings(ads: GoogleAdsClient, campaignId: string): Promise<CampaignSettings | null> {
  digits(campaignId)
  const rows = await ads.searchStream(
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type,
       campaign.bidding_strategy, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas,
       campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas, campaign.start_date_time, campaign.end_date_time,
       campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.reference_count
     FROM campaign WHERE campaign.id = ${campaignId}`
  )
  const r = rows[0]
  if (!r?.campaign) return null
  const c = r.campaign
  const b = r.campaignBudget ?? {}
  const micros = (v: unknown) => (v == null ? null : Number(v) / 1e6)
  return {
    campaignId: String(c.id ?? campaignId),
    name: c.name ?? '',
    status: c.status ?? null,
    channelType: c.advertisingChannelType ?? null,
    biddingStrategyType: c.biddingStrategyType ?? null,
    portfolio: !!c.biddingStrategy,
    targetCpa: micros(c.maximizeConversions?.targetCpaMicros ?? c.targetCpa?.targetCpaMicros) || null,
    targetRoas: Number(c.maximizeConversionValue?.targetRoas ?? c.targetRoas?.targetRoas) || null,
    budgetResource: c.campaignBudget ?? null,
    dailyBudget: micros(b.amountMicros),
    budgetShared: !!b.explicitlyShared,
    budgetCampaigns: Number(b.referenceCount ?? 1) || 1,
    startDate: c.startDateTime ? String(c.startDateTime).slice(0, 10) : null,
    endDate: c.endDateTime ? String(c.endDateTime).slice(0, 10) : null,
  }
}

export function budgetOps(s: CampaignSettings, dailyBudget: number): OpList {
  if (!s.budgetResource) throw new AdsMutationError('This campaign has no budget to change', 'validate', [], 400)
  return new OpList().add(
    'campaignBudgetOperation',
    { update: { resourceName: s.budgetResource, amountMicros: toMicros(dailyBudget) }, updateMask: 'amount_micros' },
    'Budget'
  )
}

/** Target CPA / ROAS on the campaign's own strategy. null clears an optional target. */
export function biddingTargetOps(cid: string, s: CampaignSettings, change: { targetCpa?: number | null; targetRoas?: number | null }): OpList {
  if (s.portfolio) {
    throw new AdsMutationError('This campaign uses a shared bid strategy. Change its targets in Google Ads.', 'validate', [], 400)
  }
  const resourceName = rn.campaign(cid, s.campaignId)
  const op = (fields: Record<string, any>, mask: string) =>
    new OpList().add('campaignOperation', { update: { resourceName, ...fields }, updateMask: mask }, 'Bid target')
  switch (s.biddingStrategyType) {
    case 'MAXIMIZE_CONVERSIONS':
      return op({ maximizeConversions: change.targetCpa ? { targetCpaMicros: toMicros(change.targetCpa) } : {} }, 'maximize_conversions.target_cpa_micros')
    case 'MAXIMIZE_CONVERSION_VALUE':
      return op({ maximizeConversionValue: change.targetRoas ? { targetRoas: change.targetRoas } : {} }, 'maximize_conversion_value.target_roas')
    case 'TARGET_CPA':
      if (!change.targetCpa) throw new AdsMutationError('Target CPA cannot be empty for this strategy', 'validate', [], 400)
      return op({ targetCpa: { targetCpaMicros: toMicros(change.targetCpa) } }, 'target_cpa.target_cpa_micros')
    case 'TARGET_ROAS':
      if (!change.targetRoas) throw new AdsMutationError('Target ROAS cannot be empty for this strategy', 'validate', [], 400)
      return op({ targetRoas: { targetRoas: change.targetRoas } }, 'target_roas.target_roas')
    default:
      throw new AdsMutationError('This bid strategy has no target to change; set max CPC on the ad groups instead.', 'validate', [], 400)
  }
}
