import { describe, it, expect } from 'vitest'
import {
  Q,
  mapAd,
  mapCampaign,
  mapCustomer,
  mapDaily,
  mapGeo,
  mapProduct,
  mapRecommendation,
  mapChangeEvent,
  mapAccountBudget,
  metricsOf,
  sumByKey,
  tailId,
} from '@/lib/google-ads/queries'

const range = { from: '2026-09-17', to: '2026-10-16' }

describe('GAQL builders', () => {
  it('scopes date-ranged reports to the window', () => {
    for (const q of [Q.campaignDaily(range), Q.adGroupDaily(range), Q.products(range), Q.searchTerms(range), Q.geo(range), Q.keywords(range), Q.ads(range)]) {
      expect(q).toContain("segments.date BETWEEN '2026-09-17' AND '2026-10-16'")
    }
  })

  it('selects the reporting segments and metrics', () => {
    const q = Q.campaignDaily(range)
    for (const f of ['campaign.id', 'segments.date', 'segments.device', 'segments.ad_network_type', 'metrics.cost_micros', 'metrics.conversions_value', 'metrics.all_conversions']) {
      expect(q).toContain(f)
    }
    expect(q).toMatch(/FROM campaign\s/)
    expect(Q.products(range)).toMatch(/segments\.product_item_id[\s\S]*FROM shopping_performance_view/)
    expect(Q.searchTerms(range)).toMatch(/FROM search_term_view/)
    expect(Q.geo(range)).toMatch(/FROM user_location_view/)
    expect(Q.campaigns()).toContain('campaign.start_date_time')
    expect(Q.ads(range)).toContain('ad_group_ad.policy_summary.policy_topic_entries')
  })

  it('rejects anything but ISO dates (no GAQL injection)', () => {
    expect(() => Q.campaignDaily({ from: "2026-01-01' OR 1=1", to: '2026-01-02' })).toThrow('Invalid date range')
  })

  it('bounds and sanitizes change_event', () => {
    const q = Q.changeEvents("2026-10-03 00:00:00'; DROP", 50000)
    expect(q).toContain("change_event.change_date_time >= '2026-10-03 00:00:00 '")
    expect(q).toContain('LIMIT 10000')
    expect(Q.changeEvents('2026-10-03 00:00:00', 0)).toContain('LIMIT 1')
  })

  it('only quotes well-formed geo target resource names', () => {
    expect(Q.geoNames(['geoTargetConstants/20453', "x') OR ('1"])).toContain("IN ('geoTargetConstants/20453')")
  })
})

describe('row mappers', () => {
  it('reads int64 strings and doubles from metrics', () => {
    expect(metricsOf({ metrics: { impressions: '120', clicks: '7', costMicros: '4560000', conversions: 1.5, conversionsValue: 999.5, allConversions: 2 } })).toEqual({
      impressions: 120,
      clicks: 7,
      cost_micros: 4560000,
      conversions: 1.5,
      conversions_value: 999.5,
      all_conversions: 2,
    })
    expect(metricsOf({}).impressions).toBe(0)
  })

  it('maps the customer and campaign attributes', () => {
    expect(mapCustomer({ customer: { id: '1234567890', descriptiveName: 'Acme', currencyCode: 'INR', timeZone: 'Asia/Kolkata', optimizationScore: 0.8, testAccount: true } })).toMatchObject({
      customer_id: '1234567890',
      currency_code: 'INR',
      optimization_score: 0.8,
      test_account: true,
      manager: false,
    })
    expect(
      mapCampaign({
        campaign: { id: '11', name: 'Search', status: 'ENABLED', advertisingChannelType: 'SEARCH', startDateTime: '2026-01-01 00:00:00' },
        campaignBudget: { amountMicros: '250000000', period: 'DAILY' },
      })
    ).toMatchObject({ campaign_id: '11', budget_amount_micros: 250000000, budget_period: 'DAILY', start_date: '2026-01-01', end_date: null })
  })

  it('marks campaign-level daily rows with ad group 0', () => {
    const row = { campaign: { id: '11' }, adGroup: { id: '21' }, segments: { date: '2026-10-16', device: 'MOBILE', adNetworkType: 'SEARCH' }, metrics: { clicks: '3' } }
    expect(mapDaily(row, false)).toMatchObject({ ad_group_id: '0', device: 'MOBILE', network: 'SEARCH', clicks: 3 })
    expect(mapDaily(row, true).ad_group_id).toBe('21')
  })

  it('keeps ad policy topics and headlines', () => {
    const a = mapAd({
      adGroupAd: {
        ad: { id: '31', type: 'RESPONSIVE_SEARCH_AD', finalUrls: ['https://x'], responsiveSearchAd: { headlines: [{ text: 'H1' }, { text: 'H2' }] } },
        status: 'ENABLED',
        policySummary: { approvalStatus: 'DISAPPROVED', reviewStatus: 'REVIEWED', policyTopicEntries: [{ topic: 'TRADEMARKS', type: 'PROHIBITED' }] },
      },
      adGroup: { id: '21' },
      campaign: { id: '11' },
    })
    expect(a).toMatchObject({ ad_id: '31', approval_status: 'DISAPPROVED', headlines: ['H1', 'H2'], final_urls: ['https://x'] })
    expect(a.policy_topics).toEqual([{ topic: 'TRADEMARKS', type: 'PROHIBITED' }])
  })

  it('lower-cases shopping item ids to match offer ids', () => {
    expect(mapProduct({ segments: { productItemId: 'SKU-AbC', date: '2026-10-16' }, campaign: { id: '1' } }).item_id).toBe('sku-abc')
  })

  it('falls back to the country when no region is reported', () => {
    expect(mapGeo({ userLocationView: { countryCriterionId: '2356' }, segments: { date: '2026-10-16' } }).location).toBe('geoTargetConstants/2356')
  })

  it('maps recommendations, change events and budgets', () => {
    expect(mapRecommendation({ recommendation: { resourceName: 'customers/1/recommendations/9', type: 'KEYWORD', campaign: 'customers/1/campaigns/55' } })).toMatchObject({
      campaign_id: '55',
      dismissed: false,
    })
    expect(mapChangeEvent({ changeEvent: { resourceName: 'r', campaign: 'customers/1/campaigns/7', changedFields: 'name,status' } }).campaign_id).toBe('7')
    expect(
      mapAccountBudget([
        { accountBudget: { status: 'CANCELLED', approvedSpendingLimitMicros: '1' } },
        { accountBudget: { status: 'APPROVED', approvedSpendingLimitMicros: '5000000000', amountServedMicros: '1000000000' } },
      ])
    ).toMatchObject({ budget_status: 'APPROVED', budget_limit_micros: 5000000000, budget_served_micros: 1000000000 })
    expect(mapAccountBudget([])).toBeNull()
    expect(tailId('customers/1/adGroupCriteria/2~3')).toBe('3')
  })

  it('sums duplicate keys', () => {
    const base = { impressions: 1, clicks: 1, cost_micros: 10, conversions: 0.5, conversions_value: 5, all_conversions: 1 }
    const out = sumByKey([{ k: 'a', ...base }, { k: 'a', ...base }, { k: 'b', ...base }], r => r.k)
    expect(out).toHaveLength(2)
    expect(out.find(r => r.k === 'a')).toMatchObject({ impressions: 2, cost_micros: 20, conversions: 1 })
  })
})
