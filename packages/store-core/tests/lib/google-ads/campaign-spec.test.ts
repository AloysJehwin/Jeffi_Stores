import { describe, it, expect } from 'vitest'
import { CampaignSpecSchema, specProblems, extensionProblems, STRATEGIES_FOR, type CampaignSpec } from '@/lib/google-ads/campaign-spec'

const TODAY = '2026-10-16'
const ad = { headlines: ['One', 'Two', 'Three'], descriptions: ['First description.', 'Second description.'], finalUrl: 'https://shop.in' }

function spec(over: Record<string, unknown> = {}): CampaignSpec {
  return CampaignSpecSchema.parse({
    type: 'SEARCH',
    name: 'Drills',
    dailyBudget: 300,
    bidding: { strategy: 'MAXIMIZE_CONVERSIONS' },
    locations: [{ id: 'geoTargetConstants/2356', name: 'India' }],
    languages: ['languageConstants/1000'],
    adGroups: [{ name: 'Drills', keywords: [{ text: 'drill', matchType: 'EXACT' }], ad }],
    ...over,
  })
}

describe('campaign spec', () => {
  it('accepts a complete Search campaign', () => {
    expect(specProblems(spec(), TODAY)).toEqual([])
  })

  it('defaults to paused', () => {
    expect(spec().status).toBe('PAUSED')
  })

  it('only offers strategies Google allows per type', () => {
    expect(STRATEGIES_FOR.SHOPPING).not.toContain('MAXIMIZE_CONVERSIONS')
    expect(STRATEGIES_FOR.PERFORMANCE_MAX).not.toContain('MANUAL_CPC')
    expect(specProblems(spec({ type: 'PERFORMANCE_MAX', bidding: { strategy: 'MANUAL_CPC' }, adGroups: undefined, assetGroup: { name: 'A', finalUrl: 'https://x.in', feedOnly: true } }), TODAY)).toContain(
      'That bid strategy is not available for this campaign type'
    )
  })

  it('checks targets, dates, locations and languages', () => {
    const p = specProblems(
      spec({ bidding: { strategy: 'MANUAL_CPC', targetRoas: 4 }, startDate: '2026-10-01', endDate: '2026-09-30', locations: [], languages: [] }),
      TODAY
    )
    expect(p).toEqual(
      expect.arrayContaining([
        'Target ROAS only applies to Maximise conversion value',
        'The start date cannot be in the past',
        'The end date must be after the start date',
        'Choose at least one location',
        'Ad group "Drills": set a max CPC for manual bidding',
      ])
    )
    expect(p).not.toContain('Choose at least one language')
  })

  it('enforces RSA counts and lengths', () => {
    const p = specProblems(spec({ adGroups: [{ name: 'G', keywords: [{ text: 'x', matchType: 'EXACT' }], ad: { ...ad, headlines: ['One', 'x'.repeat(31)], path2: 'tools' } }] }), TODAY)
    expect(p).toEqual(
      expect.arrayContaining([
        'Ad group "G" headline 2 is longer than 30 characters',
        'Add at least 3 ad group "G" headlines',
        'Ad group "G": set the first display path before the second',
      ])
    )
  })

  it('needs product picks when not advertising everything', () => {
    const s = spec({ type: 'SHOPPING', bidding: { strategy: 'MANUAL_CPC' }, adGroups: undefined, listing: { dimension: 'BRAND', values: [] } })
    expect(specProblems(s, TODAY)).toEqual(['Pick the products to advertise, or advertise all products', 'Set a max CPC for manual bidding'])
  })

  it('checks Performance Max assets unless the feed alone is used', () => {
    const pmax = (assetGroup: any) => specProblems(spec({ type: 'PERFORMANCE_MAX', adGroups: undefined, assetGroup: { name: 'A', finalUrl: 'https://x.in', ...assetGroup } }), TODAY)
    expect(pmax({ feedOnly: true })).toEqual([])
    const p = pmax({ feedOnly: false, headlines: ['a', 'b', 'c'], longHeadlines: ['long'], descriptions: ['x'.repeat(70), 'y'.repeat(70)], businessName: 'A very long business name here' })
    expect(p).toEqual([
      'At least one description must be 60 characters or shorter',
      'Business name is limited to 25 characters',
      'Pick at least one product image',
    ])
  })

  it('checks extension text limits and promotion rules', () => {
    const p = extensionProblems({
      sitelinks: [{ linkText: 'x'.repeat(26), description1: 'only one', description2: '', finalUrl: 'https://x.in' }],
      callouts: ['x'.repeat(26)],
      snippets: [{ header: 'Brands', values: ['A', 'B'] }],
      promotions: [{ target: 'x'.repeat(21), percentOff: 10, amountOff: 100, code: 'A', ordersOver: 10, finalUrl: 'https://x.in' }],
      prices: [{ type: 'BRANDS', offerings: [{ header: 'A', description: 'B', price: 1, finalUrl: 'https://x.in' }] }],
    })
    expect(p).toEqual([
      'Sitelink 1: link text is longer than 25 characters',
      'Sitelink 1: give both description lines or neither',
      'Callout 1 is longer than 25 characters',
      'Add at least 3 brands snippet values',
      'Promotion 1: "what is on offer" is limited to 20 characters',
      'Promotion 1: set either a percentage or an amount off',
      'Promotion 1: use a promo code or a minimum order, not both',
      'Price list 1: needs 3 to 8 items',
    ])
  })

  it('rejects malformed input at the schema', () => {
    expect(CampaignSpecSchema.safeParse({ ...spec(), locations: [{ id: 'customers/1', name: 'x' }] }).success).toBe(false)
    expect(CampaignSpecSchema.safeParse({ ...spec(), dailyBudget: 0 }).success).toBe(false)
  })
})

describe('language criteria', () => {
  it('are only used where Google still accepts them', async () => {
    const { usesLanguageCriteria } = await import('@/lib/google-ads/campaign-spec')
    expect(usesLanguageCriteria('SEARCH')).toBe(false)
    expect(usesLanguageCriteria('SHOPPING')).toBe(false)
    expect(usesLanguageCriteria('PERFORMANCE_MAX')).toBe(true)
    expect(usesLanguageCriteria('DISPLAY')).toBe(true)
  })
  it('still requires one for Display', () => {
    expect(specProblems({ ...spec({ languages: [] }), type: 'DISPLAY' } as CampaignSpec, TODAY)).toContain('Choose at least one language')
  })
})
