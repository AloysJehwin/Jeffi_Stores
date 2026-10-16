import type { CampaignSpec } from './campaign-spec'
import { filled } from './campaign-spec'
import { imageAsset, type PreparedImages } from './assets'
import { cleanAdText } from './limits'
import { OpList, TempIds, rn } from './mutate'

// Performance Max asset group: text and image assets, the asset group, their links, and the brand
// assets. Brand guidelines are on (Google's default for new campaigns), so the business name and
// logo link to the campaign, not the asset group. A feed-only asset group carries no assets and
// lets Google build the ads from the Merchant Center feed.

export const PMAX_FIELD = {
  headline: 'HEADLINE',
  longHeadline: 'LONG_HEADLINE',
  description: 'DESCRIPTION',
  landscape: 'MARKETING_IMAGE',
  square: 'SQUARE_MARKETING_IMAGE',
  logo: 'LOGO',
  businessName: 'BUSINESS_NAME',
} as const

export function assetGroupOps(
  customerId: string,
  campaign: string,
  group: NonNullable<CampaignSpec['assetGroup']>,
  opts: { ids: TempIds; ops: OpList; images?: PreparedImages | null; stamp: string }
): { assetGroupTempId: number } {
  const { ids, ops } = opts
  const assetGroupTempId = ids.next()
  const assetGroup = rn.assetGroup(customerId, assetGroupTempId)
  const links: { asset: string; fieldType: string; label: string }[] = []
  const brand: { asset: string; fieldType: string; label: string }[] = []

  if (!group.feedOnly) {
    // Google keeps one text asset per text; a line used twice (headline and business name) is created once.
    const texts = new Map<string, string>()
    const text = (value: string, fieldType: string, label: string, headline = false) => {
      const clean = cleanAdText(value, { headline })
      let name = texts.get(clean)
      if (!name) {
        name = rn.asset(customerId, ids.next())
        texts.set(clean, name)
        ops.create('assetOperation', { resourceName: name, textAsset: { text: clean } }, label)
      }
      return { asset: name, fieldType, label }
    }
    filled(group.headlines).forEach((h, i) => links.push(text(h, PMAX_FIELD.headline, `Headline ${i + 1}`, true)))
    filled(group.longHeadlines).forEach((h, i) => links.push(text(h, PMAX_FIELD.longHeadline, `Long headline ${i + 1}`)))
    filled(group.descriptions).forEach((d, i) => links.push(text(d, PMAX_FIELD.description, `Description ${i + 1}`)))

    const images = opts.images
    const image = (data: string, fieldType: string, label: string) => {
      const name = rn.asset(customerId, ids.next())
      ops.create('assetOperation', imageAsset(name, `${group.name} ${label} ${opts.stamp}`.slice(0, 120), data), label)
      return { asset: name, fieldType, label }
    }
    images?.landscape.forEach((d, i) => links.push(image(d, PMAX_FIELD.landscape, `Landscape image ${i + 1}`)))
    images?.square.forEach((d, i) => links.push(image(d, PMAX_FIELD.square, `Square image ${i + 1}`)))
    if (group.businessName.trim()) brand.push(text(group.businessName.trim(), PMAX_FIELD.businessName, 'Business name'))
    if (images?.logo) brand.push(image(images.logo, PMAX_FIELD.logo, 'Logo'))
  }

  ops.create(
    'assetGroupOperation',
    { resourceName: assetGroup, campaign, name: group.name, finalUrls: [group.finalUrl], status: 'ENABLED' },
    `Asset group ${group.name}`
  )
  for (const l of links) ops.create('assetGroupAssetOperation', { assetGroup, asset: l.asset, fieldType: l.fieldType }, `${l.label} (link)`)
  for (const b of brand) ops.create('campaignAssetOperation', { campaign, asset: b.asset, fieldType: b.fieldType }, `${b.label} (link)`)
  return { assetGroupTempId }
}
