import { z } from 'zod'
import { COUNTS, LIMITS, adTextLength, keywordProblem, textListProblems } from './limits'

// What the campaign wizard sends. Client-safe (types, schema and the cross-field checks the wizard
// runs before calling the server, which runs them again).

export const CAMPAIGN_TYPES = ['SEARCH', 'SHOPPING', 'PERFORMANCE_MAX'] as const
export const BID_STRATEGIES = ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'MANUAL_CPC'] as const
export const MATCH_TYPES = ['EXACT', 'PHRASE', 'BROAD'] as const
export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
/** Listing-group dimension: brand, one of our custom labels, or categories (as item ids). */
export const LISTING_DIMENSIONS = ['ALL', 'BRAND', 'MARGIN', 'VELOCITY', 'STOCK', 'CATEGORY'] as const
export const PRICE_TYPES = ['PRODUCT_CATEGORIES', 'PRODUCT_TIERS', 'BRANDS'] as const
export const SNIPPET_HEADERS = ['Brands', 'Types', 'Styles', 'Models', 'Service catalog'] as const

export type CampaignType = (typeof CAMPAIGN_TYPES)[number]
export type BidStrategy = (typeof BID_STRATEGIES)[number]
export type MatchType = (typeof MATCH_TYPES)[number]
export type Day = (typeof DAYS)[number]
export type ListingDimension = (typeof LISTING_DIMENSIONS)[number]

/** Strategies Google allows per campaign type (Standard Shopping has no campaign-level Maximise conversions). */
export const STRATEGIES_FOR: Record<CampaignType, BidStrategy[]> = {
  SEARCH: ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'MANUAL_CPC'],
  SHOPPING: ['MAXIMIZE_CONVERSION_VALUE', 'MANUAL_CPC'],
  PERFORMANCE_MAX: ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE'],
}

export const INDIA = { id: 'geoTargetConstants/2356', name: 'India' }

/** Google language criterion ids (developers.google.com/google-ads/api/data/codes-formats). */
export const LANGUAGES: { id: string; name: string }[] = [
  { id: 'languageConstants/1000', name: 'English' },
  { id: 'languageConstants/1023', name: 'Hindi' },
  { id: 'languageConstants/1056', name: 'Bengali' },
  { id: 'languageConstants/1072', name: 'Gujarati' },
  { id: 'languageConstants/1086', name: 'Kannada' },
  { id: 'languageConstants/1098', name: 'Malayalam' },
  { id: 'languageConstants/1101', name: 'Marathi' },
  { id: 'languageConstants/1110', name: 'Punjabi' },
  { id: 'languageConstants/1130', name: 'Tamil' },
  { id: 'languageConstants/1131', name: 'Telugu' },
  { id: 'languageConstants/1041', name: 'Urdu' },
]

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const money = z.number().finite().min(0)
const optMoney = money.nullable().optional()
const url = z.string().trim().regex(/^https?:\/\/\S+$/i, 'Use a full http(s) link')
const text = z.string().max(400)
const keyword = z.object({ text: z.string().trim().min(1).max(200), matchType: z.enum(MATCH_TYPES) })
const location = z.object({ id: z.string().regex(/^geoTargetConstants\/\d+$/), name: z.string().max(200) })

const rsa = z.object({
  headlines: z.array(text).max(20),
  descriptions: z.array(text).max(10),
  path1: z.string().max(40).optional(),
  path2: z.string().max(40).optional(),
  finalUrl: url,
})

export const AdGroupSpecSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  cpcBid: optMoney,
  keywords: z.array(keyword).max(200),
  negatives: z.array(keyword).max(200).optional(),
  ad: rsa,
})

export const SitelinkSchema = z.object({
  linkText: z.string().trim().min(1).max(60),
  description1: z.string().trim().max(80).optional(),
  description2: z.string().trim().max(80).optional(),
  finalUrl: url,
})

export const PromotionSchema = z.object({
  target: z.string().trim().min(1).max(60),
  percentOff: z.number().positive().max(100).nullable().optional(),
  amountOff: z.number().positive().nullable().optional(),
  code: z.string().trim().max(30).nullable().optional(),
  ordersOver: z.number().positive().nullable().optional(),
  startDate: z.string().regex(DATE).nullable().optional(),
  endDate: z.string().regex(DATE).nullable().optional(),
  finalUrl: url,
})

export const PriceSchema = z.object({
  type: z.enum(PRICE_TYPES),
  qualifier: z.enum(['FROM', 'UP_TO', 'AVERAGE']).nullable().optional(),
  offerings: z
    .array(z.object({ header: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(60), price: money, finalUrl: url }))
    .max(10),
})

export const SnippetSchema = z.object({ header: z.enum(SNIPPET_HEADERS), values: z.array(z.string().trim().min(1).max(60)).max(12) })

export const ExtensionsSchema = z.object({
  sitelinks: z.array(SitelinkSchema).max(20).default([]),
  callouts: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  snippets: z.array(SnippetSchema).max(5).default([]),
  promotions: z.array(PromotionSchema).max(10).default([]),
  prices: z.array(PriceSchema).max(3).default([]),
})

export const CampaignSpecSchema = z.object({
  type: z.enum(CAMPAIGN_TYPES),
  name: z.string().trim().min(1, 'Name the campaign').max(LIMITS.name),
  dailyBudget: z.number().finite().min(1, 'Set a daily budget').max(10_000_000),
  bidding: z.object({
    strategy: z.enum(BID_STRATEGIES),
    targetCpa: optMoney,
    targetRoas: z.number().positive().max(1000).nullable().optional(),
  }),
  status: z.enum(['PAUSED', 'ENABLED']).default('PAUSED'),
  startDate: z.string().regex(DATE).nullable().optional(),
  endDate: z.string().regex(DATE).nullable().optional(),
  locations: z.array(location).max(100),
  excludedLocations: z.array(location).max(100).optional(),
  languages: z.array(z.string().regex(/^languageConstants\/\d+$/)).max(20),
  schedule: z
    .object({ days: z.array(z.enum(DAYS)).min(1).max(7), startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24) })
    .nullable()
    .optional(),
  networks: z.object({ searchPartners: z.boolean(), display: z.boolean() }).optional(),
  /** Device bid adjustments in percent (-90..+900); -100 excludes the device. */
  devices: z
    .object({
      mobile: z.number().min(-100).max(900).nullable().optional(),
      desktop: z.number().min(-100).max(900).nullable().optional(),
      tablet: z.number().min(-100).max(900).nullable().optional(),
    })
    .optional(),
  defaultCpc: optMoney,
  adGroups: z.array(AdGroupSpecSchema).max(20).optional(),
  campaignNegatives: z.array(keyword).max(500).optional(),
  listing: z
    .object({ dimension: z.enum(LISTING_DIMENSIONS), values: z.array(z.string().trim().min(1).max(200)).max(1000) })
    .optional(),
  assetGroup: z
    .object({
      name: z.string().trim().min(1).max(LIMITS.name),
      finalUrl: url,
      feedOnly: z.boolean(),
      headlines: z.array(text).max(20).default([]),
      longHeadlines: z.array(text).max(10).default([]),
      descriptions: z.array(text).max(10).default([]),
      businessName: z.string().trim().max(60).default(''),
      imageIds: z.array(z.string().regex(UUID)).max(10).default([]),
      useStoreLogo: z.boolean().default(true),
    })
    .optional(),
  extensions: ExtensionsSchema.optional(),
})

export type CampaignSpec = z.infer<typeof CampaignSpecSchema>
export type AdGroupSpec = z.infer<typeof AdGroupSpecSchema>
export type ExtensionsSpec = z.infer<typeof ExtensionsSchema>
export type SitelinkSpec = z.infer<typeof SitelinkSchema>
export type PromotionSpec = z.infer<typeof PromotionSchema>
export type PriceSpec = z.infer<typeof PriceSchema>
export type SnippetSpec = z.infer<typeof SnippetSchema>
export type KeywordSpec = z.infer<typeof keyword>

export const filled = (list: string[] | undefined) => (list ?? []).map(s => s.trim()).filter(Boolean)

export function extensionProblems(x: ExtensionsSpec | undefined): string[] {
  if (!x) return []
  const out: string[] = []
  x.sitelinks.forEach((s, i) => {
    const n = `Sitelink ${i + 1}`
    if (adTextLength(s.linkText) > LIMITS.sitelinkText) out.push(`${n}: link text is longer than ${LIMITS.sitelinkText} characters`)
    const d1 = s.description1?.trim() ?? ''
    const d2 = s.description2?.trim() ?? ''
    if (!!d1 !== !!d2) out.push(`${n}: give both description lines or neither`)
    if (adTextLength(d1) > LIMITS.sitelinkDescription || adTextLength(d2) > LIMITS.sitelinkDescription) {
      out.push(`${n}: descriptions are limited to ${LIMITS.sitelinkDescription} characters`)
    }
  })
  out.push(...textListProblems('Callout', x.callouts, LIMITS.callout))
  x.snippets.forEach(s => out.push(...textListProblems(`${s.header} snippet value`, s.values, LIMITS.snippetValue, COUNTS.snippetValues)))
  x.promotions.forEach((p, i) => {
    const n = `Promotion ${i + 1}`
    if (adTextLength(p.target) > LIMITS.promotionTarget) out.push(`${n}: "what is on offer" is limited to ${LIMITS.promotionTarget} characters`)
    if (!!p.percentOff === !!p.amountOff) out.push(`${n}: set either a percentage or an amount off`)
    if (p.code && p.ordersOver) out.push(`${n}: use a promo code or a minimum order, not both`)
    if (p.startDate && p.endDate && p.endDate < p.startDate) out.push(`${n}: ends before it starts`)
  })
  x.prices.forEach((p, i) => {
    const n = `Price list ${i + 1}`
    if (p.offerings.length < COUNTS.priceOfferings[0] || p.offerings.length > COUNTS.priceOfferings[1]) {
      out.push(`${n}: needs ${COUNTS.priceOfferings[0]} to ${COUNTS.priceOfferings[1]} items`)
    }
    p.offerings.forEach((o, j) => {
      if (adTextLength(o.header) > LIMITS.priceHeader) out.push(`${n} item ${j + 1}: header is limited to ${LIMITS.priceHeader} characters`)
      if (adTextLength(o.description) > LIMITS.priceDescription) {
        out.push(`${n} item ${j + 1}: description is limited to ${LIMITS.priceDescription} characters`)
      }
    })
  })
  return out
}

export function rsaProblems(label: string, ad: AdGroupSpec['ad']): string[] {
  const out = [
    ...textListProblems(`${label} headline`, filled(ad.headlines), LIMITS.headline, COUNTS.rsaHeadlines),
    ...textListProblems(`${label} description`, filled(ad.descriptions), LIMITS.description, COUNTS.rsaDescriptions),
  ]
  for (const p of [ad.path1, ad.path2]) {
    if (p && adTextLength(p.trim()) > LIMITS.path) out.push(`${label}: display path parts are limited to ${LIMITS.path} characters`)
  }
  if (!ad.path1?.trim() && ad.path2?.trim()) out.push(`${label}: set the first display path before the second`)
  return out
}

/** Everything wrong with a spec, in words; empty when it can be sent to Google. */
export function specProblems(spec: CampaignSpec, today = new Date().toISOString().slice(0, 10)): string[] {
  const out: string[] = []
  if (!STRATEGIES_FOR[spec.type].includes(spec.bidding.strategy)) out.push('That bid strategy is not available for this campaign type')
  if (spec.bidding.strategy !== 'MAXIMIZE_CONVERSIONS' && spec.bidding.targetCpa) out.push('Target CPA only applies to Maximise conversions')
  if (spec.bidding.strategy !== 'MAXIMIZE_CONVERSION_VALUE' && spec.bidding.targetRoas) {
    out.push('Target ROAS only applies to Maximise conversion value')
  }
  if (spec.startDate && spec.startDate < today) out.push('The start date cannot be in the past')
  if (spec.endDate && spec.endDate < (spec.startDate || today)) out.push('The end date must be after the start date')
  if (!spec.locations.length) out.push('Choose at least one location')
  if (spec.type !== 'SHOPPING' && !spec.languages.length) out.push('Choose at least one language')
  if (spec.schedule && spec.schedule.endHour <= spec.schedule.startHour) out.push('The ad schedule must end after it starts')

  if (spec.type === 'SEARCH') {
    const groups = spec.adGroups ?? []
    if (!groups.length) out.push('Add at least one ad group')
    groups.forEach(g => {
      const n = `Ad group "${g.name}"`
      if (!g.keywords.length) out.push(`${n}: add at least one keyword`)
      for (const k of [...g.keywords, ...(g.negatives ?? [])]) {
        const p = keywordProblem(k.text)
        if (p) out.push(`${n}: ${p}`)
      }
      if (spec.bidding.strategy === 'MANUAL_CPC' && !(g.cpcBid || spec.defaultCpc)) out.push(`${n}: set a max CPC for manual bidding`)
      out.push(...rsaProblems(n, g.ad))
    })
  }

  if (spec.type === 'SHOPPING' || spec.type === 'PERFORMANCE_MAX') {
    const l = spec.listing
    if (l && l.dimension !== 'ALL' && !l.values.length) out.push('Pick the products to advertise, or advertise all products')
    if (spec.type === 'SHOPPING' && spec.bidding.strategy === 'MANUAL_CPC' && !spec.defaultCpc) out.push('Set a max CPC for manual bidding')
  }

  if (spec.type === 'PERFORMANCE_MAX') {
    const a = spec.assetGroup
    if (!a) out.push('Set up the asset group')
    else if (!a.feedOnly) {
      out.push(...textListProblems('Headline', filled(a.headlines), LIMITS.headline, COUNTS.pmaxHeadlines))
      out.push(...textListProblems('Long headline', filled(a.longHeadlines), LIMITS.longHeadline, COUNTS.pmaxLongHeadlines))
      out.push(...textListProblems('Description', filled(a.descriptions), LIMITS.description, COUNTS.pmaxDescriptions))
      if (filled(a.descriptions).length && !filled(a.descriptions).some(d => adTextLength(d) <= LIMITS.shortDescription)) {
        out.push(`At least one description must be ${LIMITS.shortDescription} characters or shorter`)
      }
      if (!a.businessName.trim()) out.push('Add the business name')
      else if (adTextLength(a.businessName.trim()) > LIMITS.businessName) out.push(`Business name is limited to ${LIMITS.businessName} characters`)
      if (!a.imageIds.length) out.push('Pick at least one product image')
    }
  }

  out.push(...extensionProblems(spec.extensions))
  return out
}
