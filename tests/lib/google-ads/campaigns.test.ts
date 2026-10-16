import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, refreshMirror } = vi.hoisted(() => ({ queryOne: vi.fn(), refreshMirror: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { CampaignSpecSchema, type CampaignSpec } from '@/lib/google-ads/campaign-spec'
import {
  biddingFields,
  biddingTargetOps,
  budgetOps,
  buildCampaign,
  createCampaign,
  deviceModifier,
  deviceOps,
  removeOps,
  statusOps,
  type CampaignSettings,
} from '@/lib/google-ads/campaigns'
import { caseValue, pmaxTreeOps, shoppingTreeOps } from '@/lib/google-ads/listing'
import { extensionOps } from '@/lib/google-ads/assets'

const CID = '1234567890'
const base = 'https://shop.example.in'

function spec(over: Record<string, unknown> = {}): CampaignSpec {
  return CampaignSpecSchema.parse({
    type: 'SEARCH',
    name: 'Drills',
    dailyBudget: 500,
    bidding: { strategy: 'MAXIMIZE_CONVERSIONS', targetCpa: 250 },
    status: 'PAUSED',
    startDate: '2026-11-01',
    locations: [
      { id: 'geoTargetConstants/2356', name: 'India' },
    ],
    languages: ['languageConstants/1000', 'languageConstants/1023'],
    networks: { searchPartners: true, display: false },
    adGroups: [
      {
        name: 'Cordless drills',
        keywords: [
          { text: 'Cordless Drill!', matchType: 'PHRASE' },
          { text: 'cordless drill', matchType: 'PHRASE' },
          { text: 'drill machine', matchType: 'EXACT' },
        ],
        negatives: [{ text: 'repair', matchType: 'PHRASE' }],
        ad: { headlines: ['Cordless Drills', 'Free Delivery!', 'Shop Now'], descriptions: ['Top brands in stock.', 'Fast delivery across India.'], path1: 'drills', finalUrl: `${base}/categories/drills` },
      },
    ],
    campaignNegatives: [{ text: 'free', matchType: 'BROAD' }],
    ...over,
  })
}

const opKey = (o: any) => Object.keys(o)[0]
const created = (o: any) => (Object.values(o)[0] as any).create

describe('buildCampaign: Search', () => {
  const b = buildCampaign(spec(), { customerId: CID, stamp: 't1' })
  const ops = b.ops.operations

  it('creates the budget first, then the campaign pointing at it by temp id', () => {
    expect(opKey(ops[0])).toBe('campaignBudgetOperation')
    expect(created(ops[0])).toEqual({
      resourceName: `customers/${CID}/campaignBudgets/-1`,
      name: 'Drills budget t1',
      amountMicros: '500000000',
      deliveryMethod: 'STANDARD',
      explicitlyShared: false,
    })
    const c = created(ops[1])
    expect(c).toMatchObject({
      resourceName: `customers/${CID}/campaigns/-2`,
      campaignBudget: `customers/${CID}/campaignBudgets/-1`,
      advertisingChannelType: 'SEARCH',
      status: 'PAUSED',
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      startDateTime: '2026-11-01 00:00:00',
      maximizeConversions: { targetCpaMicros: '250000000' },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
    })
    expect(c.endDateTime).toBeUndefined()
  })

  it('targets locations, and no languages on Search (Google rejects them since Sept 2026)', () => {
    const crit = ops.filter(o => opKey(o) === 'campaignCriterionOperation').map(created)
    expect(crit).toContainEqual({ campaign: `customers/${CID}/campaigns/-2`, location: { geoTargetConstant: 'geoTargetConstants/2356' } })
    expect(crit.some((c: any) => c.language)).toBe(false)
    expect(crit).toContainEqual({ campaign: `customers/${CID}/campaigns/-2`, negative: true, keyword: { text: 'free', matchType: 'BROAD' } })
  })

  it('adds the ad group, cleaned and de-duplicated keywords, negatives and the RSA under one temp id', () => {
    const ag = ops.find(o => opKey(o) === 'adGroupOperation')!
    expect(created(ag)).toEqual({
      resourceName: `customers/${CID}/adGroups/-3`,
      campaign: `customers/${CID}/campaigns/-2`,
      name: 'Cordless drills',
      status: 'ENABLED',
      type: 'SEARCH_STANDARD',
    })
    const kws = ops.filter(o => opKey(o) === 'adGroupCriterionOperation').map(created)
    expect(kws).toEqual([
      { adGroup: `customers/${CID}/adGroups/-3`, status: 'ENABLED', keyword: { text: 'cordless drill', matchType: 'PHRASE' } },
      { adGroup: `customers/${CID}/adGroups/-3`, status: 'ENABLED', keyword: { text: 'drill machine', matchType: 'EXACT' } },
      { adGroup: `customers/${CID}/adGroups/-3`, status: 'ENABLED', negative: true, keyword: { text: 'repair', matchType: 'PHRASE' } },
    ])
    const ad = created(ops.find(o => opKey(o) === 'adGroupAdOperation')!)
    expect(ad.ad.finalUrls).toEqual([`${base}/categories/drills`])
    expect(ad.ad.responsiveSearchAd.headlines).toEqual([{ text: 'Cordless Drills' }, { text: 'Free Delivery' }, { text: 'Shop Now' }])
    expect(ad.ad.responsiveSearchAd.path1).toBe('drills')
    expect(ad.ad.responsiveSearchAd.path2).toBeUndefined()
  })

  it('labels every operation for readable errors', () => {
    expect(b.ops.labels).toHaveLength(ops.length)
    expect(b.ops.labels).toContain('Ad group Cordless drills: responsive search ad')
    expect(b.tree).toBeNull()
  })

  it('sets max CPC bids only for manual bidding', () => {
    const manual = buildCampaign(spec({ bidding: { strategy: 'MANUAL_CPC' }, defaultCpc: 12.5 }), { customerId: CID })
    expect(created(manual.ops.operations[1]).manualCpc).toEqual({})
    expect(created(manual.ops.operations.find(o => opKey(o) === 'adGroupOperation')!).cpcBidMicros).toBe('12500000')
  })
})

describe('bidding', () => {
  it('maps each strategy to its campaign field', () => {
    expect(biddingFields({ strategy: 'MAXIMIZE_CONVERSIONS' })).toEqual({ maximizeConversions: {} })
    expect(biddingFields({ strategy: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: 4 })).toEqual({ maximizeConversionValue: { targetRoas: 4 } })
    expect(biddingFields({ strategy: 'MANUAL_CPC' })).toEqual({ manualCpc: {} })
  })
})

describe('buildCampaign: Shopping', () => {
  const shopping = (listing: any, over: any = {}) =>
    buildCampaign(spec({ type: 'SHOPPING', bidding: { strategy: 'MANUAL_CPC' }, defaultCpc: 8, adGroups: undefined, listing, ...over }), {
      customerId: CID,
      merchantId: '5762156822',
      listing,
    })

  it('needs a Merchant Center account', () => {
    expect(() => buildCampaign(spec({ type: 'SHOPPING', bidding: { strategy: 'MANUAL_CPC' } }), { customerId: CID })).toThrow('Link a Merchant Center account first')
  })

  it('sets the shopping setting, a product ad group and an all-products unit with the bid', () => {
    const b = shopping({ dimension: 'ALL', values: [] })
    const ops = b.ops.operations
    expect(created(ops[1])).toMatchObject({
      advertisingChannelType: 'SHOPPING',
      shoppingSetting: { merchantId: '5762156822', feedLabel: 'IN', campaignPriority: 0, enableLocal: false },
      networkSettings: { targetContentNetwork: false },
    })
    expect(ops.filter(o => opKey(o) === 'campaignCriterionOperation').some(o => created(o).language)).toBe(false)
    expect(created(ops.find(o => opKey(o) === 'adGroupOperation')!)).toMatchObject({ type: 'SHOPPING_PRODUCT_ADS', cpcBidMicros: '8000000' })
    expect(created(ops.find(o => opKey(o) === 'adGroupAdOperation')!).ad).toEqual({ shoppingProductAd: {} })
    const unit = created(ops.find(o => opKey(o) === 'adGroupCriterionOperation')!)
    expect(unit).toEqual({ adGroup: `customers/${CID}/adGroups/-3`, status: 'ENABLED', listingGroup: { type: 'UNIT' }, cpcBidMicros: '8000000' })
    expect(b.tree).toBeNull()
  })

  it('leaves a subdivided tree for the follow-up mutate (needs the real ad group id)', () => {
    const b = shopping({ dimension: 'BRAND', values: ['Bosch', 'Makita'] })
    expect(b.tree).toEqual({ dimension: 'BRAND', values: ['Bosch', 'Makita'] })
    expect(b.ops.operations.some(o => opKey(o) === 'adGroupCriterionOperation')).toBe(false)
    expect(opKey(b.ops.operations[b.parentOpIndex!])).toBe('adGroupOperation')
  })
})

describe('listing trees', () => {
  it('builds a Shopping tree: root subdivision, one bid unit per value, everything else excluded', () => {
    const ops = shoppingTreeOps(CID, '777', { dimension: 'MARGIN', values: ['margin-high', 'margin-medium', 'MARGIN-HIGH'] }, { cpcBid: 5 })
    const c = ops.operations.map(created)
    expect(c[0]).toEqual({ resourceName: `customers/${CID}/adGroupCriteria/777~-1`, adGroup: `customers/${CID}/adGroups/777`, status: 'ENABLED', listingGroup: { type: 'SUBDIVISION' } })
    expect(c).toHaveLength(4)
    expect(c[1]).toEqual({
      adGroup: `customers/${CID}/adGroups/777`,
      status: 'ENABLED',
      listingGroup: { type: 'UNIT', parentAdGroupCriterion: `customers/${CID}/adGroupCriteria/777~-1`, caseValue: { productCustomAttribute: { index: 'INDEX0', value: 'margin-high' } } },
      cpcBidMicros: '5000000',
    })
    expect(c[3]).toEqual({
      adGroup: `customers/${CID}/adGroups/777`,
      status: 'ENABLED',
      negative: true,
      listingGroup: { type: 'UNIT', parentAdGroupCriterion: `customers/${CID}/adGroupCriteria/777~-1`, caseValue: { productCustomAttribute: { index: 'INDEX0' } } },
    })
  })

  it('builds the Performance Max filter tree with included and excluded units', () => {
    const c = pmaxTreeOps(CID, '88', { dimension: 'CATEGORY', values: ['tw-001', 'tw-002'] }).operations.map(created)
    expect(c[0]).toEqual({ assetGroup: `customers/${CID}/assetGroups/88`, listingSource: 'SHOPPING', resourceName: `customers/${CID}/assetGroupListingGroupFilters/88~-1`, type: 'SUBDIVISION' })
    expect(c[1]).toMatchObject({ type: 'UNIT_INCLUDED', caseValue: { productItemId: { value: 'tw-001' } }, parentListingGroupFilter: `customers/${CID}/assetGroupListingGroupFilters/88~-1` })
    expect(c[3]).toMatchObject({ type: 'UNIT_EXCLUDED', caseValue: { productItemId: {} } })
  })

  it('maps every dimension to Google case values', () => {
    expect(caseValue('BRAND', 'Bosch')).toEqual({ productBrand: { value: 'Bosch' } })
    expect(caseValue('VELOCITY', 'bestseller')).toEqual({ productCustomAttribute: { index: 'INDEX1', value: 'bestseller' } })
    expect(caseValue('STOCK')).toEqual({ productCustomAttribute: { index: 'INDEX2' } })
    expect(() => caseValue('ALL' as any)).toThrow()
  })
})

describe('buildCampaign: Performance Max', () => {
  const pmax = (assetGroup: any, images: any = null) =>
    buildCampaign(
      spec({
        type: 'PERFORMANCE_MAX',
        bidding: { strategy: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: 4 },
        adGroups: undefined,
        campaignNegatives: [{ text: 'free', matchType: 'BROAD' }],
        listing: { dimension: 'ALL', values: [] },
        assetGroup,
      }),
      { customerId: CID, merchantId: '42', images, stamp: 's' }
    )

  it('feed only: asset group plus the all-products filter, no assets', () => {
    const b = pmax({ name: 'All products', finalUrl: base, feedOnly: true })
    const ops = b.ops.operations
    expect(created(ops[1])).toMatchObject({ advertisingChannelType: 'PERFORMANCE_MAX', brandGuidelinesEnabled: true, shoppingSetting: { merchantId: '42', feedLabel: 'IN' } })
    expect(created(ops[1]).networkSettings).toBeUndefined()
    expect(ops.some(o => opKey(o) === 'assetOperation')).toBe(false)
    expect(ops.filter(o => opKey(o) === 'campaignCriterionOperation').some(o => created(o).keyword)).toBe(false)
    const group = created(ops.find(o => opKey(o) === 'assetGroupOperation')!)
    expect(group).toEqual({ resourceName: `customers/${CID}/assetGroups/-3`, campaign: `customers/${CID}/campaigns/-2`, name: 'All products', finalUrls: [base], status: 'ENABLED' })
    expect(created(ops.at(-1))).toEqual({ assetGroup: `customers/${CID}/assetGroups/-3`, listingSource: 'SHOPPING', type: 'UNIT_INCLUDED' })
    expect(b.devices).toBeNull()
  })

  it('with assets: texts and images link to the asset group, business name and logo to the campaign', () => {
    const b = pmax(
      {
        name: 'Tools',
        finalUrl: base,
        feedOnly: false,
        headlines: ['Tools!', 'Power tools', 'Hand tools'],
        longHeadlines: ['Power and hand tools from top brands'],
        descriptions: ['Shop tools online.', 'Fast delivery across India on every order.'],
        businessName: 'Acme Tools',
        imageIds: ['11111111-1111-4111-8111-111111111111'],
      },
      { landscape: ['L64'], square: ['S64'], logo: 'G64' }
    )
    const ops = b.ops.operations
    const groupIndex = ops.findIndex(o => opKey(o) === 'assetGroupOperation')
    expect(b.parentOpIndex).toBe(groupIndex)
    // every asset is created before the asset group and its links
    expect(ops.slice(0, groupIndex).filter(o => opKey(o) === 'assetOperation')).toHaveLength(10)
    expect(created(ops.find(o => opKey(o) === 'assetOperation')!).textAsset).toEqual({ text: 'Tools' })
    const image = ops.map(created).find(c => c?.imageAsset?.data === 'L64')
    expect(image).toMatchObject({ type: 'IMAGE', name: 'Tools Landscape image 1 s' })
    const links = ops.filter(o => opKey(o) === 'assetGroupAssetOperation').map(created)
    expect(links.map(l => l.fieldType).sort()).toEqual(
      ['DESCRIPTION', 'DESCRIPTION', 'HEADLINE', 'HEADLINE', 'HEADLINE', 'LONG_HEADLINE', 'MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE'].sort()
    )
    expect(links.every(l => l.assetGroup === `customers/${CID}/assetGroups/${idOfGroup(ops)}`)).toBe(true)
    const brand = ops.filter(o => opKey(o) === 'campaignAssetOperation').map(created)
    expect(brand.map(x => x.fieldType)).toEqual(['BUSINESS_NAME', 'LOGO'])
    expect(brand.every(x => x.campaign === `customers/${CID}/campaigns/-2`)).toBe(true)
  })
})

describe('Performance Max text assets', () => {
  it('creates a text used twice once and links it under both field types', () => {
    const b = buildCampaign(
      spec({
        type: 'PERFORMANCE_MAX',
        bidding: { strategy: 'MAXIMIZE_CONVERSIONS' },
        adGroups: undefined,
        listing: { dimension: 'ALL', values: [] },
        assetGroup: {
          name: 'G',
          finalUrl: base,
          feedOnly: false,
          headlines: ['Acme Tools', 'Drills', 'Saws'],
          longHeadlines: ['Long headline'],
          descriptions: ['One.', 'Two.'],
          businessName: 'Acme Tools',
          imageIds: [],
        },
      }),
      { customerId: CID, merchantId: '42', images: { landscape: [], square: [], logo: null } }
    )
    const texts = b.ops.operations.filter(o => opKey(o) === 'assetOperation').map(o => created(o).textAsset.text)
    expect(texts.filter(t => t === 'Acme Tools')).toHaveLength(1)
    const headline = b.ops.operations.map(created).find((c: any) => c?.fieldType === 'HEADLINE')
    const business = b.ops.operations.map(created).find((c: any) => c?.fieldType === 'BUSINESS_NAME')
    expect(business.asset).toBe(headline.asset)
  })
})

function idOfGroup(ops: any[]) {
  return created(ops.find(o => opKey(o) === 'assetGroupOperation')).resourceName.split('/').pop()
}

describe('extension assets', () => {
  it('creates each asset and links it to the campaign with its field type', () => {
    const ops = extensionOps(CID, `customers/${CID}/campaigns/55`, {
      sitelinks: [{ linkText: 'Drills', description1: 'Cordless and corded', description2: 'Top brands', finalUrl: `${base}/categories/drills` }],
      callouts: ['Free delivery over ₹999', ' '],
      snippets: [{ header: 'Brands', values: ['Bosch', 'Makita', 'Stanley'] }],
      promotions: [{ target: 'Sitewide', percentOff: 10, code: 'WELCOME10', finalUrl: base }, { target: 'Tools', amountOff: 300, ordersOver: 2000, finalUrl: base }],
      prices: [{ type: 'PRODUCT_CATEGORIES', offerings: [{ header: 'Drill', description: 'Bosch', price: 2499, finalUrl: `${base}/products/drill` }] }],
    }).operations.map(o => [opKey(o), created(o)])
    expect(ops.filter(([k]) => k === 'assetOperation')).toHaveLength(6)
    expect(ops[0][1]).toEqual({ resourceName: `customers/${CID}/assets/-1`, finalUrls: [`${base}/categories/drills`], sitelinkAsset: { linkText: 'Drills', description1: 'Cordless and corded', description2: 'Top brands' } })
    expect(ops[1][1]).toEqual({ campaign: `customers/${CID}/campaigns/55`, asset: `customers/${CID}/assets/-1`, fieldType: 'SITELINK' })
    const promo = ops.map(([, c]) => c).filter((c: any) => c.promotionAsset)
    expect(promo[0].promotionAsset).toEqual({ promotionTarget: 'Sitewide', languageCode: 'en', percentOff: '100000', promotionCode: 'WELCOME10' })
    expect(promo[1].promotionAsset).toMatchObject({
      moneyAmountOff: { currencyCode: 'INR', amountMicros: '300000000' },
      ordersOverAmount: { currencyCode: 'INR', amountMicros: '2000000000' },
    })
    const price = ops.map(([, c]) => c).find((c: any) => c.priceAsset)
    expect(price.priceAsset.priceOfferings[0].price).toEqual({ currencyCode: 'INR', amountMicros: '2499000000' })
    expect(ops.filter(([k]) => k === 'campaignAssetOperation').map(([, c]: any) => c.fieldType)).toEqual(['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'PROMOTION', 'PROMOTION', 'PRICE'])
  })
})

describe('edits on existing entities', () => {
  it('changes status with an update mask and removes by resource name', () => {
    expect(statusOps(CID, { kind: 'keyword', adGroupId: '7', criterionId: '99' }, 'PAUSED').operations[0]).toEqual({
      adGroupCriterionOperation: { update: { resourceName: `customers/${CID}/adGroupCriteria/7~99`, status: 'PAUSED' }, updateMask: 'status' },
    })
    expect(removeOps(CID, { kind: 'ad', adGroupId: '7', adId: '5' }).operations[0]).toEqual({ adGroupAdOperation: { remove: `customers/${CID}/adGroupAds/7~5` } })
    expect(() => statusOps(CID, { kind: 'campaign', campaignId: '1 OR 1=1' }, 'PAUSED')).toThrow('Invalid id')
  })

  const settings = (over: Partial<CampaignSettings> = {}): CampaignSettings => ({
    campaignId: '55',
    name: 'Drills',
    status: 'ENABLED',
    channelType: 'SEARCH',
    biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
    portfolio: false,
    targetCpa: null,
    targetRoas: null,
    budgetResource: `customers/${CID}/campaignBudgets/9`,
    dailyBudget: 500,
    budgetShared: false,
    budgetCampaigns: 1,
    startDate: null,
    endDate: null,
    ...over,
  })

  it('updates the budget amount in micros', () => {
    expect(budgetOps(settings(), 750).operations[0]).toEqual({
      campaignBudgetOperation: { update: { resourceName: `customers/${CID}/campaignBudgets/9`, amountMicros: '750000000' }, updateMask: 'amount_micros' },
    })
  })

  it('sets or clears targets on the campaign strategy', () => {
    expect(biddingTargetOps(CID, settings(), { targetCpa: 300 }).operations[0].campaignOperation).toEqual({
      update: { resourceName: `customers/${CID}/campaigns/55`, maximizeConversions: { targetCpaMicros: '300000000' } },
      updateMask: 'maximize_conversions.target_cpa_micros',
    })
    expect(biddingTargetOps(CID, settings({ biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE' }), { targetRoas: null }).operations[0].campaignOperation).toEqual({
      update: { resourceName: `customers/${CID}/campaigns/55`, maximizeConversionValue: {} },
      updateMask: 'maximize_conversion_value.target_roas',
    })
    expect(() => biddingTargetOps(CID, settings({ portfolio: true }), { targetCpa: 1 })).toThrow('shared bid strategy')
    expect(() => biddingTargetOps(CID, settings({ biddingStrategyType: 'MANUAL_CPC' }), { targetCpa: 1 })).toThrow('no target')
  })
})

describe('device bid adjustments', () => {
  it('converts percent to a modifier', () => {
    expect(deviceModifier(20)).toBe(1.2)
    expect(deviceModifier(-50)).toBe(0.5)
    expect(deviceModifier(-100)).toBe(0)
    expect(deviceModifier(5000)).toBe(10)
  })

  it('updates existing device criteria and creates missing ones', async () => {
    const ads = { searchStream: vi.fn(async () => [{ campaignCriterion: { criterionId: '30001', device: { type: 'MOBILE' } } }]) } as any
    const ops = (await deviceOps(ads, CID, '55', { mobile: 20, tablet: -100 })).operations
    expect(ops[0]).toEqual({
      campaignCriterionOperation: { update: { resourceName: `customers/${CID}/campaignCriteria/55~30001`, bidModifier: 1.2 }, updateMask: 'bid_modifier' },
    })
    expect(ops[1]).toEqual({ campaignCriterionOperation: { create: { campaign: `customers/${CID}/campaigns/55`, device: { type: 'TABLET' }, bidModifier: 0 } } })
  })
})

describe('createCampaign', () => {
  const fetchMock = vi.fn()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const client = () =>
    new GoogleAdsClient({
      refreshToken: 'rt',
      customerId: CID,
      developerToken: 'dev',
      fetchImpl: fetchMock as any,
      retryDelays: [],
      getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }),
    })
  const actor = { adminId: null, email: 'owner@store.in' }
  const shoppingSpec = spec({ type: 'SHOPPING', bidding: { strategy: 'MAXIMIZE_CONVERSION_VALUE' }, adGroups: undefined, listing: { dimension: 'BRAND', values: ['Bosch'] } })
  const ctx = { customerId: CID, merchantId: '42', listing: { dimension: 'BRAND' as const, values: ['Bosch'] } }
  const mainResult = () =>
    json({
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: `customers/${CID}/campaignBudgets/900` } },
        { campaignResult: { resourceName: `customers/${CID}/campaigns/901` } },
        { campaignCriterionResult: { resourceName: 'c' } },
        { campaignCriterionResult: { resourceName: 'c2' } },
        { adGroupResult: { resourceName: `customers/${CID}/adGroups/902` } },
        { adGroupAdResult: { resourceName: 'ad' } },
      ],
    })
  const bodies = () => fetchMock.mock.calls.map(c => JSON.parse(c[1].body))

  beforeEach(() => {
    fetchMock.mockReset()
    queryOne.mockReset().mockResolvedValue({ id: '1' })
    refreshMirror.mockReset().mockResolvedValue({})
  })

  it('previews with one validateOnly call and returns the operation counts', async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    const r: any = await createCampaign(shoppingSpec, ctx, actor, { client: client(), preview: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies()[0].validateOnly).toBe(true)
    expect(r.operations).toMatchObject({ campaignBudgetOperation: 1, campaignOperation: 1, adGroupOperation: 1 })
    expect(r.followUps).toEqual(['Product groups by brand (1)'])
  })

  it('creates, then validates and commits the product groups against the real ad group id', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(mainResult()).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [] }))
    const r: any = await createCampaign(shoppingSpec, ctx, actor, { client: client() })
    expect(r.campaignId).toBe('901')
    expect(r.steps.map((s: any) => s.action)).toEqual(['campaign.create', 'campaign.listing_groups'])
    const [, , treeCheck, treeCommit] = bodies()
    expect(treeCheck.validateOnly).toBe(true)
    expect(treeCommit.mutateOperations[0].adGroupCriterionOperation.create.resourceName).toBe(`customers/${CID}/adGroupCriteria/902~-1`)
    expect(refreshMirror).toHaveBeenCalledWith(expect.anything(), { campaignChildren: ['901'] })
  })

  it('removes the new campaign when Google rejects the follow-up', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(mainResult())
      .mockResolvedValueOnce(json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Listing group is invalid' } }, 400))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ mutateOperationResponses: [] }))
    const err = await createCampaign(shoppingSpec, ctx, actor, { client: client() }).catch(e => e)
    expect(err.message).toMatch(/new campaign was removed again/)
    const rollback = bodies()[4].mutateOperations
    expect(rollback).toEqual([
      { campaignOperation: { remove: `customers/${CID}/campaigns/901` } },
      { campaignBudgetOperation: { remove: `customers/${CID}/campaignBudgets/900` } },
    ])
    const statuses = queryOne.mock.calls.filter(c => String(c[0]).includes('ads_change_log')).map(c => [c[1][2], c[1][7]])
    expect(statuses).toEqual([
      ['campaign.create', 'applied'],
      ['campaign.listing_groups', 'rejected'],
      ['campaign.remove', 'applied'],
    ])
  })
})
