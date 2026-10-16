import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, refreshMirror } = vi.hoisted(() => ({ queryOne: vi.fn(), refreshMirror: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { CampaignSpecSchema, DEMAND_GEN_MIN_DAILY_FALLBACK, specProblems, type CampaignSpec } from '@/lib/google-ads/campaign-spec'
import { buildCampaign, biddingFields, createCampaign } from '@/lib/google-ads/campaigns'
import { demandGenMinimumDaily, listAudiences } from '@/lib/google-ads/image-ads'

const CID = '1234567890'
const IMG = '11111111-2222-3333-4444-555555555555'
const AUD = `customers/${CID}/audiences/77`

function spec(type: 'DEMAND_GEN' | 'DISPLAY', over: Record<string, unknown> = {}): CampaignSpec {
  return CampaignSpecSchema.parse({
    type,
    name: 'Tools awareness',
    dailyBudget: 800,
    bidding: { strategy: 'MAXIMIZE_CONVERSIONS' },
    locations: [{ id: 'geoTargetConstants/2356', name: 'India' }],
    languages: ['languageConstants/1000'],
    devices: { mobile: 20 },
    imageAd: {
      finalUrl: 'https://shop.example.in',
      headlines: ['Power Tools', 'Free Delivery!'],
      longHeadline: 'Professional power tools delivered across India',
      descriptions: ['Top brands in stock, delivered fast.'],
      businessName: 'Acme Tools',
      callToAction: 'Shop now',
      imageIds: [IMG],
      audiences: type === 'DEMAND_GEN' ? [AUD] : [],
    },
    ...over,
  })
}

const images = { landscape: ['L64'], square: ['S64'], portrait: ['P64'], logo: 'LOGO64' }
const opKey = (o: any) => Object.keys(o)[0]
const created = (o: any) => (Object.values(o)[0] as any).create

describe('Demand Gen campaign', () => {
  const b = buildCampaign(spec('DEMAND_GEN'), { customerId: CID, images, stamp: 't1' })
  const ops = b.ops.operations

  it('creates budget, campaign, ad group, assets and the multi-asset ad with temp ids in order', () => {
    expect(ops.map(opKey).slice(0, 3)).toEqual(['campaignBudgetOperation', 'campaignOperation', 'adGroupOperation'])
    expect(opKey(ops[ops.length - 1])).toBe('adGroupAdOperation')
    const c = created(ops[1])
    expect(c).toMatchObject({ resourceName: `customers/${CID}/campaigns/-2`, advertisingChannelType: 'DEMAND_GEN', maximizeConversions: {} })
    expect(c.networkSettings).toBeUndefined()
    expect(c.geoTargetTypeSetting).toBeUndefined()
    expect(created(ops[2])).toEqual({
      resourceName: `customers/${CID}/adGroups/-3`,
      campaign: `customers/${CID}/campaigns/-2`,
      name: 'Tools awareness ad group',
      status: 'ENABLED',
      audienceSetting: { useAudienceGrouped: true },
      demandGenAdGroupSettings: { channelControls: { channelStrategy: 'ALL_CHANNELS' } },
    })
  })

  it('targets locations, languages and audiences on the ad group, not the campaign', () => {
    expect(ops.some(o => opKey(o) === 'campaignCriterionOperation')).toBe(false)
    const crit = ops.filter(o => opKey(o) === 'adGroupCriterionOperation').map(created)
    const ag = `customers/${CID}/adGroups/-3`
    expect(crit).toEqual([
      { adGroup: ag, location: { geoTargetConstant: 'geoTargetConstants/2356' } },
      { adGroup: ag, language: { languageConstant: 'languageConstants/1000' } },
      { adGroup: ag, audience: { audience: AUD } },
    ])
  })

  it('uploads landscape, square, portrait and logo images and references them from the ad', () => {
    const assets = ops.filter(o => opKey(o) === 'assetOperation').map(created)
    expect(assets.map(a => a.imageAsset.data)).toEqual(['L64', 'S64', 'P64', 'LOGO64'])
    expect(assets.every(a => a.type === 'IMAGE' && /\/assets\/-\d+$/.test(a.resourceName))).toBe(true)
    const ad = created(ops[ops.length - 1]).ad
    expect(ad.finalUrls).toEqual(['https://shop.example.in'])
    expect(ad.demandGenMultiAssetAd).toEqual({
      marketingImages: [{ asset: assets[0].resourceName }],
      squareMarketingImages: [{ asset: assets[1].resourceName }],
      portraitMarketingImages: [{ asset: assets[2].resourceName }],
      logoImages: [{ asset: assets[3].resourceName }],
      headlines: [{ text: 'Power Tools' }, { text: 'Free Delivery' }],
      descriptions: [{ text: 'Top brands in stock, delivered fast.' }],
      businessName: 'Acme Tools',
      callToActionText: 'Shop now',
    })
  })

  it('takes no device bid adjustments and needs no Merchant Center', () => {
    expect(b.devices).toBeNull()
    expect(b.tree).toBeNull()
  })
})

describe('Display campaign', () => {
  const b = buildCampaign(spec('DISPLAY', { bidding: { strategy: 'MANUAL_CPC' }, defaultCpc: 4 }), { customerId: CID, images: { ...images, portrait: undefined }, stamp: 't1' })
  const ops = b.ops.operations

  it('targets on the campaign and creates a DISPLAY_STANDARD ad group with the manual CPC', () => {
    const c = created(ops[1])
    expect(c).toMatchObject({ advertisingChannelType: 'DISPLAY', manualCpc: {}, geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' } })
    const crit = ops.filter(o => opKey(o) === 'campaignCriterionOperation').map(created)
    expect(crit).toHaveLength(2)
    expect(created(ops.find(o => opKey(o) === 'adGroupOperation')!)).toMatchObject({ type: 'DISPLAY_STANDARD', cpcBidMicros: '4000000' })
  })

  it('builds a responsive display ad with a long headline and a square logo', () => {
    const rda = created(ops[ops.length - 1]).ad.responsiveDisplayAd
    expect(rda.longHeadline).toEqual({ text: 'Professional power tools delivered across India' })
    expect(rda.squareLogoImages).toHaveLength(1)
    expect(rda.marketingImages).toHaveLength(1)
    expect(rda.squareMarketingImages).toHaveLength(1)
    expect(rda.portraitMarketingImages).toBeUndefined()
    expect(b.devices).toEqual({ mobile: 20 })
  })

  it('maps Maximise clicks to target spend', () => {
    expect(biddingFields({ strategy: 'MAXIMIZE_CLICKS' })).toEqual({ targetSpend: {} })
  })
})

describe('validation', () => {
  it('enforces the Demand Gen daily minimum, from Google or the fallback', () => {
    expect(specProblems(spec('DEMAND_GEN', { dailyBudget: 300 }), '2026-10-16', { demandGenMinimum: 450 })).toContain(
      "Demand Gen needs a daily budget of at least 450 (Google's minimum)"
    )
    expect(specProblems(spec('DEMAND_GEN', { dailyBudget: 460 }), '2026-10-16', { demandGenMinimum: 450 })).toEqual([])
    expect(specProblems(spec('DEMAND_GEN', { dailyBudget: 460 }), '2026-10-16').join()).toContain(String(DEMAND_GEN_MIN_DAILY_FALLBACK))
    expect(specProblems(spec('DISPLAY', { dailyBudget: 50 }), '2026-10-16')).toEqual([])
  })

  it('checks asset counts and lengths per type', () => {
    const bad = spec('DISPLAY', {
      imageAd: { finalUrl: 'https://x.in', headlines: ['A'.repeat(31), 'b', 'c', 'd', 'e', 'f'], longHeadline: '', descriptions: [], businessName: '', imageIds: [] },
    })
    const p = specProblems(bad, '2026-10-16')
    expect(p).toEqual(
      expect.arrayContaining([
        'Headline 1 is longer than 30 characters',
        'Use at most 5 headlines',
        'Add at least 1 descriptions',
        'Add a long headline',
        'Add the business name',
        'Pick at least one product image',
      ])
    )
    expect(specProblems(spec('DISPLAY', { imageAd: { ...spec('DEMAND_GEN').imageAd } }), '2026-10-16')).toContain('Audiences are only added to Demand Gen campaigns here')
    expect(specProblems(spec('DEMAND_GEN', { bidding: { strategy: 'MANUAL_CPC' } }), '2026-10-16')).toContain('That bid strategy is not available for this campaign type')
  })
})

describe('createCampaign for image ads', () => {
  const fetchMock = vi.fn()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const client = () =>
    new GoogleAdsClient({ refreshToken: 'rt', customerId: CID, developerToken: 'dev', fetchImpl: fetchMock as any, retryDelays: [], getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }) })
  const actor = { adminId: null, email: 'owner@store.in' }
  const bodies = () => fetchMock.mock.calls.map(c => JSON.parse(c[1].body))

  beforeEach(() => {
    fetchMock.mockReset()
    queryOne.mockReset().mockResolvedValue({ id: '1' })
    refreshMirror.mockReset().mockResolvedValue({})
  })

  it('validates, then commits once with the same operations and no Merchant Center', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(
      json({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: 'b' } }, { campaignResult: { resourceName: `customers/${CID}/campaigns/55` } }] })
    )
    const r: any = await createCampaign(spec('DEMAND_GEN'), { customerId: CID, images }, actor, { client: client() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [v, c] = bodies()
    expect(v.validateOnly).toBe(true)
    expect(c.validateOnly).toBeUndefined()
    expect(c.mutateOperations).toEqual(v.mutateOperations)
    expect(r.campaignId).toBe('55')
    expect(r.steps).toEqual([{ action: 'campaign.create', ok: true }])
  })

  it('surfaces Google rejecting the budget at validation and creates nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            status: 'INVALID_ARGUMENT',
            details: [
              {
                '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure',
                errors: [
                  { errorCode: { campaignBudgetError: 'BUDGET_BELOW_PER_DAY_MINIMUM' }, message: 'Budget below minimum.', location: { fieldPathElements: [{ fieldName: 'mutate_operations', index: 0 }] } },
                ],
              },
            ],
          },
        },
        400
      )
    )
    await expect(createCampaign(spec('DEMAND_GEN'), { customerId: CID, images }, actor, { client: client() })).rejects.toMatchObject({
      stage: 'validate',
      message: 'Budget: Budget below minimum.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('live Demand Gen helpers', () => {
  it("reads Google's minimum for the currency and lists audiences", async () => {
    const searchStream = vi.fn(async (q: string) =>
      q.includes('currency_constant')
        ? [{ currencyConstant: { code: 'INR', demandGenInfo: { minimumBudgetPerDayMicros: '445000000' } } }]
        : [{ audience: { resourceName: AUD, name: 'Past buyers' } }, { audience: { resourceName: 'bad', name: 'x' } }]
    )
    const ads = { searchStream } as any
    expect(await demandGenMinimumDaily(ads, 'INR')).toBe(445)
    expect(searchStream.mock.calls[0][0]).toContain("currency_constant.code = 'INR'")
    expect(await demandGenMinimumDaily(ads, "IN'R")).toBeNull()
    expect(await listAudiences(ads)).toEqual([{ id: AUD, name: 'Past buyers' }])
    expect(await demandGenMinimumDaily({ searchStream: vi.fn(async () => Promise.reject(new Error('x'))) } as any, 'INR')).toBeNull()
  })
})
