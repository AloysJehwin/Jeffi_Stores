import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, refreshMirror } = vi.hoisted(() => ({ queryOne: vi.fn(), refreshMirror: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { ActionSchema, runAction } from '@/lib/google-ads/actions'

const CID = '1234567890'
const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ads = () =>
  new GoogleAdsClient({
    refreshToken: 'rt',
    customerId: CID,
    developerToken: 'dev',
    fetchImpl: fetchMock as any,
    retryDelays: [],
    getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }),
  })
const actor = { adminId: null, email: 'owner@store.in' }
const calls = () => fetchMock.mock.calls.map(c => ({ url: String(c[0]), body: JSON.parse(c[1].body) }))
const parse = (b: unknown) => ActionSchema.parse(b)
const logged = () => queryOne.mock.calls.filter(c => String(c[0]).includes('INSERT INTO ads_change_log')).map(c => c[1])

beforeEach(() => {
  fetchMock.mockReset()
  refreshMirror.mockReset().mockResolvedValue({})
  queryOne.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO ads_change_log')) return { id: '5' }
    if (sql.includes('FROM ads_campaigns')) return { name: 'Drills' }
    if (sql.includes('FROM ads_ad_groups')) return { name: 'Cordless' }
    if (sql.includes('FROM ads_keywords')) return { text: 'cordless drill' }
    if (sql.includes('FROM ads_recommendations')) return { type: 'KEYWORD', campaign_id: '55' }
    return null
  })
})

describe('edit actions', () => {
  it('pauses a campaign: validateOnly, then the update with a status mask, then a campaign refresh', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [{ campaignResult: { resourceName: `customers/${CID}/campaigns/55` } }] }))
    const r = await runAction(parse({ action: 'campaign.status', campaignId: '55', status: 'PAUSED' }), ads(), actor)
    const [check, commit] = calls()
    expect(check.body.validateOnly).toBe(true)
    expect(commit.body.mutateOperations).toEqual([
      { campaignOperation: { update: { resourceName: `customers/${CID}/campaigns/55`, status: 'PAUSED' }, updateMask: 'status' } },
    ])
    expect(r.summary).toBe('Paused campaign "Drills"')
    expect(refreshMirror).toHaveBeenCalledWith(expect.anything(), { campaignIds: ['55'] })
    expect(logged()[0].slice(2, 8)).toEqual(['campaign.status', 'campaign', '55', 'Paused campaign "Drills"', expect.any(String), 'applied'])
  })

  it('previews without committing', async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    const r = await runAction(parse({ action: 'keyword.remove', adGroupId: '7', criterionId: '99' }), ads(), actor, true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ preview: true, summary: 'Removed keyword "cordless drill"' })
    expect(calls()[0].body.mutateOperations).toEqual([{ adGroupCriterionOperation: { remove: `customers/${CID}/adGroupCriteria/7~99` } }])
  })

  it('adds a search term as a keyword to its ad group and refreshes that ad group\'s keywords', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [{ adGroupCriterionResult: { resourceName: 'k' } }] }))
    await runAction(parse({ action: 'keyword.add', adGroupId: '7', text: 'Bosch Drill!', matchType: 'EXACT' }), ads(), actor)
    expect(calls()[1].body.mutateOperations[0]).toEqual({
      adGroupCriterionOperation: { create: { adGroup: `customers/${CID}/adGroups/7`, status: 'ENABLED', keyword: { text: 'bosch drill', matchType: 'EXACT' } } },
    })
    expect(refreshMirror).toHaveBeenCalledWith(expect.anything(), { keywordsInAdGroups: ['7'] })
  })

  it('adds a campaign-level negative keyword', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [{}] }))
    const r = await runAction(parse({ action: 'negative.add', level: 'campaign', campaignId: '55', text: 'free', matchType: 'EXACT' }), ads(), actor)
    expect(calls()[1].body.mutateOperations[0]).toEqual({
      campaignCriterionOperation: { create: { campaign: `customers/${CID}/campaigns/55`, negative: true, keyword: { text: 'free', matchType: 'EXACT' } } },
    })
    expect(r.summary).toMatch(/negative keyword "free"/)
  })

  it('changes a budget on the campaign budget read live from Google', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json([
          {
            results: [
              {
                campaign: { id: '55', name: 'Drills', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', campaignBudget: `customers/${CID}/campaignBudgets/9` },
                campaignBudget: { amountMicros: '500000000', explicitlyShared: false, referenceCount: '1' },
              },
            ],
          },
        ])
      )
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ mutateOperationResponses: [{}] }))
    const r = await runAction(parse({ action: 'campaign.budget', campaignId: '55', dailyBudget: 800 }), ads(), actor)
    expect(calls()[0].url).toMatch(/googleAds:searchStream$/)
    expect(calls()[2].body.mutateOperations[0]).toEqual({
      campaignBudgetOperation: { update: { resourceName: `customers/${CID}/campaignBudgets/9`, amountMicros: '800000000' }, updateMask: 'amount_micros' },
    })
    expect(r.summary).toBe('Changed the daily budget of "Drills" from 500 to 800')
  })

  it('applies a recommendation through RecommendationService (no validateOnly there) and drops it from the mirror', async () => {
    const rec = `customers/${CID}/recommendations/abc~123`
    fetchMock.mockResolvedValueOnce(json({ results: [{ resourceName: rec }] }))
    const r = await runAction(parse({ action: 'recommendation.apply', resourceName: rec }), ads(), actor)
    expect(calls()[0].url).toBe(`https://googleads.googleapis.com/v26/customers/${CID}/recommendations:apply`)
    expect(calls()[0].body).toEqual({ operations: [{ resourceName: rec }], partialFailure: false })
    expect(r.resourceNames).toEqual([rec])
    expect(refreshMirror).toHaveBeenCalledWith(expect.anything(), { recommendations: [rec], campaignIds: ['55'] })
    expect(logged()[0][7]).toBe('applied')
  })

  it('refuses a recommendation of another account', async () => {
    await expect(
      runAction(parse({ action: 'recommendation.dismiss', resourceName: 'customers/999/recommendations/x' }), ads(), actor)
    ).rejects.toThrow('another account')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds approved assets to a campaign in one validated mutate', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [{}, {}] }))
    const r = await runAction(
      parse({ action: 'assets.add', campaignId: '55', extensions: { callouts: ['Cash on delivery'] } }),
      ads(),
      actor
    )
    expect(calls()[1].body.mutateOperations).toEqual([
      { assetOperation: { create: { resourceName: `customers/${CID}/assets/-1`, calloutAsset: { calloutText: 'Cash on delivery' } } } },
      { campaignAssetOperation: { create: { campaign: `customers/${CID}/campaigns/55`, asset: `customers/${CID}/assets/-1`, fieldType: 'CALLOUT' } } },
    ])
    expect(r.summary).toBe('Added 1 callouts to campaign "Drills"')
  })

  it('rejects ids that are not numbers at the schema', () => {
    expect(ActionSchema.safeParse({ action: 'ad.remove', adGroupId: '7', adId: 'x' }).success).toBe(false)
  })
})
