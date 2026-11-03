import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  getMerchantId: vi.fn(),
  merchantApiRequest: vi.fn(),
  getPublicOffers: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ queryMany: h.queryMany, queryOne: h.queryOne, query: h.query }))
vi.mock('@/lib/shared/customer-links', () => ({ catalogBaseUrl: vi.fn(async () => 'https://acme.in/') }))
vi.mock('@/lib/merchant/client', () => ({ getMerchantId: h.getMerchantId, merchantApiRequest: h.merchantApiRequest, merchantConfigured: vi.fn(async () => true) }))
vi.mock('@/lib/shipping/delivery-settings', () => ({ getDeliverySettings: vi.fn(async () => ({ enabled: true, freeThreshold: 999, ratePerKg: 0, freeWeightCeilingKg: 3 })) }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getSiteControls: vi.fn(async () => ({ flags: { codEnabled: true, gstEnabled: true, razorpayEnabled: false }, identity: { name: 'Acme', logoUrl: '' } })),
}))
vi.mock('@/lib/payments/razorpay-offers', () => ({ getPublicOffers: h.getPublicOffers }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsApiError } from '@/lib/google-ads/client'
import { assetSuggestions, freeDeliveryCallout, parseOfferDiscount } from '@/lib/google-ads/assets'
import { suggestDailyBudget } from '@/lib/google-ads/manage-data'
import { linkMerchantCenter, merchantLinkStatus } from '@/lib/google-ads/merchant-link'
import { resolveStateNames, suggestGeo } from '@/lib/google-ads/geo'
import { generateKeywordIdeas, catalogueSeeds, dedupeKeywords } from '@/lib/google-ads/keywords'
import { refreshMirror } from '@/lib/google-ads/refresh'

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.queryOne.mockResolvedValue({ id: '1' })
  h.query.mockResolvedValue({ rows: [] })
})

describe('budget suggestion', () => {
  it('is 10% of daily revenue, rounded to ₹50, within ₹200..₹50,000', () => {
    expect(suggestDailyBudget(300_000)).toBe(1000)
    expect(suggestDailyBudget(78_451.25)).toBe(250)
    expect(suggestDailyBudget(0)).toBe(200)
    expect(suggestDailyBudget(100_000_000)).toBe(50_000)
  })
})

describe('asset suggestions from store data', () => {
  it('parses discounts out of bank offer titles', () => {
    expect(parseOfferDiscount('10% instant discount on HDFC cards')).toEqual({ percentOff: 10 })
    expect(parseOfferDiscount('Flat ₹1,500 off on EMI')).toEqual({ amountOff: 1500 })
    expect(parseOfferDiscount('Cashback on UPI')).toBeNull()
  })

  it('writes a free delivery callout within 25 characters', () => {
    expect(freeDeliveryCallout(true, 999)).toBe('Free delivery over ₹999')
    expect(freeDeliveryCallout(true, 100000)).toBe('Free delivery ₹100000+')
    expect(freeDeliveryCallout(false, 0)).toBe('Free delivery')
    expect(freeDeliveryCallout(true, 0)).toBeNull()
  })

  it('suggests sitelinks, policy callouts, coupon and bank promotions, a price list and snippets', async () => {
    h.queryMany.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM categories c')) return [{ name: 'Power Tools', slug: 'power-tools' }, { name: 'Hand Tools', slug: 'hand-tools' }, { name: 'Fasteners and Fixings Warehouse', slug: 'fasteners' }]
      if (sql.includes('FROM coupons')) return [{ code: 'WELCOME10', discount_type: 'percentage', discount_value: '10.00', min_purchase_amount: '1000', valid_until: '2026-12-31T00:00:00Z' }]
      if (sql.includes('FROM order_items')) return [1, 2, 3].map(i => ({ name: `Drill ${i}`, slug: `drill-${i}`, base_price: '2499.00', brand: 'Bosch', category: 'Power Tools', units: '5' }))
      if (sql.includes('FROM brands')) return [{ name: 'Bosch' }, { name: 'Makita' }, { name: 'Stanley' }]
      return []
    })
    h.getPublicOffers.mockResolvedValue([{ id: 'o1', title: '10% off with HDFC Bank cards', methods: ['card'], issuers: ['HDFC Bank'], endsAt: '2026-11-30T00:00:00Z', terms: null }])
    const s = await assetSuggestions()
    expect(s.sitelinks[0]).toEqual({ linkText: 'Power Tools', description1: '', description2: '', finalUrl: 'https://acme.in/categories/power-tools' })
    expect(s.sitelinks[2].linkText.length).toBeLessThanOrEqual(25)
    expect(s.callouts).toEqual(['Free delivery over ₹999', 'Cash on delivery', 'GST invoice available', 'Bank card offers'])
    expect(s.promotions[0]).toMatchObject({ target: 'Sitewide', percentOff: 10, amountOff: null, code: 'WELCOME10', endDate: '2026-12-31', finalUrl: 'https://acme.in' })
    expect(s.promotions[0].source).toMatch(/min order ₹1000/)
    expect(s.promotions[1]).toMatchObject({ target: 'HDFC Bank cards', percentOff: 10, endDate: '2026-11-30' })
    expect(s.prices[0].offerings).toHaveLength(3)
    expect(s.prices[0].offerings[0]).toEqual({ header: 'Drill 1', description: 'Bosch', price: 2499, finalUrl: 'https://acme.in/products/drill-1' })
    expect(s.snippets.map(x => x.header)).toEqual(['Brands', 'Types'])
  })
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function fakeAds(responses: Record<string, any[]>) {
  return {
    customerId: '1234567890',
    searchStream: vi.fn(async (q: string) => (q.includes('FROM product_link_invitation') ? responses.invites ?? [] : q.includes('FROM product_link') ? responses.links ?? [] : [])),
    post: vi.fn(async () => ({})),
    request: vi.fn(),
  } as any
}

describe('Merchant Center link', () => {
  it('reports linked when the store merchant is among the product links', async () => {
    const ads = fakeAds({ links: [{ productLink: { merchantCenter: { merchantCenterId: '42' } } }] })
    expect(await merchantLinkStatus(ads, '42')).toMatchObject({ merchantId: '42', linked: true, linkedIds: ['42'] })
  })

  it('accepts a pending invitation from the store merchant first', async () => {
    h.getMerchantId.mockResolvedValue('42')
    const invite = { productLinkInvitation: { resourceName: 'customers/1234567890/productLinkInvitations/7', merchantCenter: { merchantCenterId: '42' }, status: 'PENDING_APPROVAL' } }
    const ads = fakeAds({ invites: [invite] })
    const r = await linkMerchantCenter(ads, { adminId: null })
    expect(r.status).toBe('accepted')
    expect(ads.post).toHaveBeenCalledWith('/productLinkInvitations:update', { resourceName: 'customers/1234567890/productLinkInvitations/7', productLinkInvitationStatus: 'ACCEPTED' })
    expect(h.queryOne.mock.calls.some(c => String(c[0]).includes('ads_change_log') && c[1][2] === 'merchant.link' && c[1][7] === 'applied')).toBe(true)
  })

  it('links directly, or proposes from Merchant Center when the user is not admin of both', async () => {
    h.getMerchantId.mockResolvedValue('42')
    const direct = fakeAds({})
    expect((await linkMerchantCenter(direct, { adminId: null })).status).toBe('linked')
    expect(direct.post).toHaveBeenCalledWith('/productLinks:create', { productLink: { merchantCenter: { merchantCenterId: '42' } } })

    const denied = fakeAds({})
    denied.post.mockRejectedValueOnce(new GoogleAdsApiError('denied', 403, ['ACTION_NOT_PERMITTED'], null, false))
    const r = await linkMerchantCenter(denied, { adminId: null })
    expect(h.merchantApiRequest).toHaveBeenCalledWith('POST', '/accounts/v1/accounts/42/services:propose', {
      body: { provider: 'providers/GOOGLE_ADS', accountService: { campaignsManagement: {}, externalAccountId: '1234567890' } },
    })
    expect(r.status).toBe('invited')
  })

  it('needs Merchant Center connected for the store', async () => {
    h.getMerchantId.mockRejectedValue(new Error('not connected'))
    await expect(linkMerchantCenter(fakeAds({}), { adminId: null })).rejects.toThrow('Connect Google Merchant Center')
  })
})

describe('locations', () => {
  it('suggests places for a typed name (not customer scoped)', async () => {
    const ads = fakeAds({})
    ads.request.mockResolvedValue({
      geoTargetConstantSuggestions: [{ searchTerm: 'kochi', reach: '100', geoTargetConstant: { resourceName: 'geoTargetConstants/1007788', name: 'Kochi', targetType: 'City', canonicalName: 'Kochi,Kerala,India' } }],
    })
    const r = await suggestGeo(ads, 'kochi')
    expect(ads.request).toHaveBeenCalledWith('POST', '/geoTargetConstants:suggest', { locale: 'en', countryCode: 'IN', locationNames: { names: ['kochi'] } })
    expect(r[0]).toMatchObject({ id: 'geoTargetConstants/1007788', type: 'City', reach: 100 })
    expect(await suggestGeo(ads, 'k')).toEqual([])
  })

  it('resolves shipping-zone states to state targets and reports misses', async () => {
    const ads = fakeAds({})
    const g = (id: number, name: string, type: string, term: string) => ({ searchTerm: term, geoTargetConstant: { resourceName: `geoTargetConstants/${id}`, name, targetType: type } })
    ads.request.mockResolvedValue({
      geoTargetConstantSuggestions: [g(1, 'Kerala', 'State', 'Kerala'), g(2, 'Kerala', 'City', 'Kerala'), g(3, 'Delhi', 'Union Territory', 'Delhi'), g(4, 'Goa Velha', 'City', 'Goa')],
    })
    const r = await resolveStateNames(ads, ['Kerala', 'Delhi', 'Goa', 'Kerala'])
    expect(r.resolved.map(o => o.id)).toEqual(['geoTargetConstants/1', 'geoTargetConstants/3'])
    expect(r.unresolved).toEqual(['Goa'])
  })
})

describe('keywords', () => {
  it('dedupes and drops invalid keywords', () => {
    expect(dedupeKeywords([{ text: 'Drill', matchType: 'EXACT' }, { text: 'drill', matchType: 'EXACT' }, { text: 'drill', matchType: 'PHRASE' }, { text: '!!!', matchType: 'EXACT' }])).toEqual([
      { text: 'drill', matchType: 'EXACT' },
      { text: 'drill', matchType: 'PHRASE' },
    ])
  })

  it('asks Keyword Planner with a keyword + url seed for India by default', async () => {
    const ads = fakeAds({})
    ads.post.mockResolvedValue({
      results: [{ text: 'cordless drill', keywordIdeaMetrics: { avgMonthlySearches: '12100', competition: 'HIGH', lowTopOfPageBidMicros: '4000000', highTopOfPageBidMicros: '19000000' } }],
    })
    const ideas = await generateKeywordIdeas(ads, { seeds: ['Cordless Drill', 'drill'], url: 'https://acme.in/categories/drills' })
    expect(ads.post).toHaveBeenCalledWith(':generateKeywordIdeas', {
      language: 'languageConstants/1000',
      geoTargetConstants: ['geoTargetConstants/2356'],
      includeAdultKeywords: false,
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      pageSize: 50,
      keywordAndUrlSeed: { url: 'https://acme.in/categories/drills', keywords: ['cordless drill', 'drill'] },
    })
    expect(ideas).toEqual([{ text: 'cordless drill', avgMonthlySearches: 12100, competition: 'HIGH', lowBid: 4, highBid: 19 }])
  })

  it('seeds from the category, its best sellers and brand + category names', async () => {
    h.queryOne.mockResolvedValueOnce({ name: 'Drills' })
    h.queryMany.mockResolvedValueOnce([{ name: 'Bosch GSB 500 Drill', brand: 'Bosch' }])
    const r = await catalogueSeeds('4dc8105c-97b9-460a-844a-6057319b0334')
    expect(r).toEqual({ seeds: ['drills', 'bosch gsb 500 drill', 'bosch drills'], categoryName: 'Drills' })
  })
})

describe('mirror refresh', () => {
  it('upserts changed campaigns and drops removed ones', async () => {
    const ads = fakeAds({})
    ads.searchStream.mockResolvedValueOnce([
      { campaign: { id: '55', name: 'Drills', status: 'PAUSED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '1', period: 'DAILY' } },
      { campaign: { id: '56', name: 'Old', status: 'REMOVED' } },
    ])
    const r = await refreshMirror(ads, { campaignIds: ['55', '56', 'bad'] })
    expect(ads.searchStream.mock.calls[0][0]).toMatch(/WHERE campaign\.id IN \(55, 56\)/)
    const sqls = h.query.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.startsWith('DELETE FROM ads_campaigns'))).toBe(true)
    expect(h.query.mock.calls.find(c => String(c[0]).startsWith('DELETE FROM ads_campaigns'))![1]).toEqual([['56']])
    expect(sqls.some(s => s.includes('INSERT INTO ads_campaigns') && s.includes('ON CONFLICT (campaign_id) DO UPDATE'))).toBe(true)
    expect(r.campaigns).toBe(1)
  })

  it('re-reads keywords of an ad group, keeping metrics and dropping removed ones', async () => {
    const ads = fakeAds({})
    ads.searchStream.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '99', keyword: { text: 'drill', matchType: 'EXACT' }, status: 'ENABLED' }, adGroup: { id: '7' }, campaign: { id: '55' } },
    ])
    await refreshMirror(ads, { keywordsInAdGroups: ['7'] })
    const del = h.query.mock.calls.find(c => String(c[0]).startsWith('DELETE FROM ads_keywords'))!
    expect(del[1]).toEqual([['7'], ['99']])
    const ins = h.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO ads_keywords'))!
    expect(String(ins[0])).not.toMatch(/cost_micros=EXCLUDED/)
  })

  it('removes applied or dismissed recommendations from the mirror', async () => {
    const r = await refreshMirror(fakeAds({}), { recommendations: ['customers/1/recommendations/a'] })
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ads_recommendations'), [['customers/1/recommendations/a']])
    expect(r.recommendations).toBe(1)
  })
})
