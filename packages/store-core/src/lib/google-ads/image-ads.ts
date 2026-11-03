import type { GoogleAdsClient } from './client'
import type { CampaignSpec, ImageAdSpec } from './campaign-spec'
import { filled } from './campaign-spec'
import { imageAsset, type PreparedImages } from './assets'
import { cleanAdText } from './limits'
import { OpList, TempIds, rn, toMicros } from './mutate'

// Demand Gen (multi-asset ad) and Display (responsive display ad) campaigns: one ad group, the
// catalogue images as image assets and the ad, all with temp ids in the campaign's mutate. Demand
// Gen campaigns are created with upgraded targeting (Google's default), so locations, languages
// and audiences go on the ad group rather than the campaign.

const text = (s: string, headline = false) => ({ text: cleanAdText(s, { headline }) })

export function imageAdOps(
  customerId: string,
  campaign: string,
  spec: CampaignSpec,
  opts: { ids: TempIds; ops: OpList; images?: PreparedImages | null; stamp: string }
): { adGroupTempId: number } {
  const a = spec.imageAd as ImageAdSpec
  const { ids, ops } = opts
  const dg = spec.type === 'DEMAND_GEN'
  const adGroupTempId = ids.next()
  const adGroup = rn.adGroup(customerId, adGroupTempId)
  const name = (a.adGroupName.trim() || `${spec.name} ad group`).slice(0, 255)
  const manual = spec.bidding.strategy === 'MANUAL_CPC' && spec.defaultCpc

  ops.create(
    'adGroupOperation',
    dg
      ? {
          resourceName: adGroup,
          campaign,
          name,
          status: 'ENABLED',
          audienceSetting: { useAudienceGrouped: true },
          demandGenAdGroupSettings: { channelControls: { channelStrategy: a.channels } },
        }
      : { resourceName: adGroup, campaign, name, status: 'ENABLED', type: 'DISPLAY_STANDARD', ...(manual ? { cpcBidMicros: toMicros(spec.defaultCpc!) } : {}) },
    `Ad group ${name}`
  )

  if (dg) {
    for (const l of spec.locations) ops.create('adGroupCriterionOperation', { adGroup, location: { geoTargetConstant: l.id } }, `Location ${l.name}`)
    for (const l of spec.excludedLocations ?? []) {
      ops.create('adGroupCriterionOperation', { adGroup, negative: true, location: { geoTargetConstant: l.id } }, `Excluded location ${l.name}`)
    }
    for (const lang of spec.languages) ops.create('adGroupCriterionOperation', { adGroup, language: { languageConstant: lang } }, `Language ${lang}`)
    a.audiences.forEach((aud, i) => ops.create('adGroupCriterionOperation', { adGroup, audience: { audience: aud } }, `Audience ${i + 1}`))
  }

  const image = (data: string, label: string) => {
    const resourceName = rn.asset(customerId, ids.next())
    ops.create('assetOperation', imageAsset(resourceName, `${name} ${label} ${opts.stamp}`.slice(0, 120), data), label)
    return { asset: resourceName }
  }
  const imgs = opts.images
  const landscape = (imgs?.landscape ?? []).map((d, i) => image(d, `Landscape image ${i + 1}`))
  const square = (imgs?.square ?? []).map((d, i) => image(d, `Square image ${i + 1}`))
  const portrait = dg ? (imgs?.portrait ?? []).map((d, i) => image(d, `Portrait image ${i + 1}`)) : []
  const logo = imgs?.logo ? [image(imgs.logo, 'Logo')] : []
  const cta = a.callToAction ? { callToActionText: a.callToAction } : {}

  const ad = dg
    ? {
        demandGenMultiAssetAd: {
          marketingImages: landscape,
          squareMarketingImages: square,
          ...(portrait.length ? { portraitMarketingImages: portrait } : {}),
          logoImages: logo,
          headlines: filled(a.headlines).map(h => text(h, true)),
          descriptions: filled(a.descriptions).map(d => text(d)),
          businessName: a.businessName.trim(),
          ...cta,
        },
      }
    : {
        responsiveDisplayAd: {
          marketingImages: landscape,
          squareMarketingImages: square,
          ...(logo.length ? { squareLogoImages: logo } : {}),
          headlines: filled(a.headlines).map(h => text(h, true)),
          longHeadline: text(a.longHeadline),
          descriptions: filled(a.descriptions).map(d => text(d)),
          businessName: a.businessName.trim(),
          ...cta,
        },
      }
  ops.create(
    'adGroupAdOperation',
    { adGroup, status: 'ENABLED', ad: { finalUrls: [a.finalUrl], ...ad } },
    dg ? 'Demand Gen multi-asset ad' : 'Responsive display ad'
  )
  return { adGroupTempId }
}

/** Google's minimum Demand Gen daily budget in the account currency, or null when it can't be read. */
export async function demandGenMinimumDaily(ads: GoogleAdsClient, currency: string): Promise<number | null> {
  if (!/^[A-Z]{3}$/.test(currency)) return null
  try {
    const rows = await ads.searchStream(
      `SELECT currency_constant.code, currency_constant.demand_gen_info.minimum_budget_per_day_micros
       FROM currency_constant WHERE currency_constant.code = '${currency}'`
    )
    const micros = Number(rows[0]?.currencyConstant?.demandGenInfo?.minimumBudgetPerDayMicros)
    return Number.isFinite(micros) && micros > 0 ? Math.ceil(micros / 1e6) : null
  } catch {
    return null
  }
}

export interface AudienceOption {
  id: string
  name: string
}

/** Audiences in the account (AudienceService), for optional Demand Gen targeting. */
export async function listAudiences(ads: GoogleAdsClient): Promise<AudienceOption[]> {
  const rows = await ads.searchStream(
    `SELECT audience.resource_name, audience.name, audience.status FROM audience WHERE audience.status = 'ENABLED'`
  )
  return rows
    .map(r => ({ id: String(r.audience?.resourceName ?? ''), name: String(r.audience?.name ?? '') }))
    .filter(a => /^customers\/\d+\/audiences\/\d+$/.test(a.id))
    .slice(0, 200)
}
