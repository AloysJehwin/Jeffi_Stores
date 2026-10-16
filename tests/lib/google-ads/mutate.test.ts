import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, queryMany, refreshMirror } = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  refreshMirror: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany, query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import {
  AdsMutationError,
  OpList,
  TempIds,
  explainAdsError,
  idFrom,
  listAdsChanges,
  resultNames,
  rn,
  runLoggedCall,
  runMutation,
  toMicros,
  startDateTime,
  endDateTime,
} from '@/lib/google-ads/mutate'

const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function ads(retryDelays = [0, 0]) {
  return new GoogleAdsClient({
    refreshToken: 'rt',
    customerId: '1234567890',
    developerToken: 'dev',
    fetchImpl: fetchMock as any,
    retryDelays,
    getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }),
  })
}

function failure(field: string, code = 'TOO_LONG', message = 'Too long.', status = 400) {
  return json(
    {
      error: {
        code: status,
        status: 'INVALID_ARGUMENT',
        message: 'Request contains an invalid argument.',
        details: [
          {
            '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure',
            requestId: 'req-9',
            errors: [
              {
                errorCode: { stringLengthError: code },
                message,
                location: {
                  fieldPathElements: [
                    { fieldName: 'mutate_operations', index: 1 },
                    { fieldName: 'ad_group_ad_operation' },
                    { fieldName: 'create' },
                    { fieldName: 'ad' },
                    { fieldName: 'responsive_search_ad' },
                    { fieldName: 'headlines', index: 2 },
                    { fieldName: 'text' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    status
  )
}

const plan = () => {
  const ops = new OpList()
    .add('campaignOperation', { update: { resourceName: rn.campaign('1234567890', '55'), status: 'PAUSED' }, updateMask: 'status' }, 'Campaign status')
    .create('adGroupAdOperation', { adGroup: rn.adGroup('1234567890', '7') }, 'Ad group Drills: responsive search ad')
  return {
    action: 'campaign.status' as const,
    entityType: 'campaign' as const,
    entityId: '55',
    summary: 'Paused campaign "Drills"',
    operations: ops.operations,
    labels: ops.labels,
    request: { campaignId: '55' },
    refresh: { campaignIds: ['55'] },
  }
}

const body = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body)
const logRows = () => queryOne.mock.calls.filter(c => String(c[0]).includes('INSERT INTO ads_change_log'))

beforeEach(() => {
  fetchMock.mockReset()
  queryOne.mockReset().mockResolvedValue({ id: '41' })
  queryMany.mockReset().mockResolvedValue([])
  refreshMirror.mockReset().mockResolvedValue({ campaigns: 1 })
})

describe('builders', () => {
  it('converts rupees to micros at paisa precision, as strings', () => {
    expect(toMicros(500)).toBe('500000000')
    expect(toMicros(12.345)).toBe('12350000')
    expect(toMicros(0.01)).toBe('10000')
    expect(() => toMicros(-1)).toThrow()
    expect(() => toMicros(NaN)).toThrow()
  })

  it('hands out unique negative temp ids', () => {
    const ids = new TempIds()
    expect([ids.next(), ids.next(), ids.next()]).toEqual([-1, -2, -3])
  })

  it('builds resource names, composite ones with ~', () => {
    expect(rn.budget('1', -1)).toBe('customers/1/campaignBudgets/-1')
    expect(rn.adGroupAd('1', 22, 33)).toBe('customers/1/adGroupAds/22~33')
    expect(rn.adGroupCriterion('1', 22, -4)).toBe('customers/1/adGroupCriteria/22~-4')
    expect(rn.listingFilter('1', 9, -2)).toBe('customers/1/assetGroupListingGroupFilters/9~-2')
    expect(idFrom('customers/1/adGroupAds/22~33')).toBe('33')
    expect(idFrom('customers/1/campaigns/55')).toBe('55')
  })

  it('formats campaign dates for daily granularity', () => {
    expect(startDateTime('2026-11-01')).toBe('2026-11-01 00:00:00')
    expect(endDateTime('2026-11-30')).toBe('2026-11-30 23:59:59')
  })

  it('reads resource names from mutate responses', () => {
    expect(
      resultNames({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: 'customers/1/campaignBudgets/9' } }, { campaignResult: { resourceName: 'customers/1/campaigns/8' } }] })
    ).toEqual(['customers/1/campaignBudgets/9', 'customers/1/campaigns/8'])
  })

  it('counts operations per type for the preview', () => {
    const ops = new OpList().create('campaignCriterionOperation', {}, 'a').create('campaignCriterionOperation', {}, 'b').create('campaignOperation', {}, 'c')
    expect(ops.counts()).toEqual({ campaignCriterionOperation: 2, campaignOperation: 1 })
  })
})

describe('runMutation', () => {
  it('validates first, then commits the same operations and logs the change', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(
      json({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/55' } }, { adGroupAdResult: { resourceName: 'x' } }] })
    )
    const out = await runMutation(plan(), { adminId: '11111111-1111-1111-1111-111111111111', email: 'a@store.in' }, { client: ads() })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://googleads.googleapis.com/v26/customers/1234567890/googleAds:mutate')
    expect(body(0)).toMatchObject({ validateOnly: true, partialFailure: false })
    expect(body(1).validateOnly).toBeUndefined()
    expect(body(1).mutateOperations).toEqual(body(0).mutateOperations)
    expect(out).toMatchObject({ committed: true, resourceNames: ['customers/1234567890/campaigns/55', 'x'], logId: 41 })

    const [sql, params] = logRows()[0]
    expect(sql).toContain('INSERT INTO ads_change_log')
    expect(params).toEqual([
      '11111111-1111-1111-1111-111111111111',
      'a@store.in',
      'campaign.status',
      'campaign',
      '55',
      'Paused campaign "Drills"',
      JSON.stringify({ campaignId: '55' }),
      'applied',
      JSON.stringify({ resourceNames: ['customers/1234567890/campaigns/55', 'x'] }),
      null,
      null,
    ])
    expect(refreshMirror).toHaveBeenCalledWith(expect.any(GoogleAdsClient), { campaignIds: ['55'] })
  })

  it('previews with validateOnly only: no commit, no log', async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    const out = await runMutation(plan(), { adminId: null }, { client: ads(), preview: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body(0).validateOnly).toBe(true)
    expect(out.committed).toBe(false)
    expect(logRows()).toHaveLength(0)
    expect(refreshMirror).not.toHaveBeenCalled()
  })

  it('stops at a failed validation, names the operation, and logs it as rejected', async () => {
    fetchMock.mockResolvedValueOnce(failure('x'))
    const err = await runMutation(plan(), { adminId: null }, { client: ads() }).catch(e => e)
    expect(err).toBeInstanceOf(AdsMutationError)
    expect(err.stage).toBe('validate')
    expect(err.message).toBe('Ad group Drills: responsive search ad: ad.responsive search ad.headlines[2].text: Too long.')
    expect(err.problems[0]).toMatchObject({ code: 'TOO_LONG' })
    expect(err.requestId).toBe('req-9')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logRows()[0][1][7]).toBe('rejected')
    expect(logRows()[0][1][10]).toBe('req-9')
  })

  it('never retries the commit (temp-id creates are not idempotent) and logs it as failed', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValue(json({ error: { code: 500, status: 'INTERNAL', message: 'boom' } }, 500))
    const err = await runMutation(plan(), { adminId: null }, { client: ads([0, 0]) }).catch(e => e)
    expect(err).toBeInstanceOf(AdsMutationError)
    expect(err.stage).toBe('commit')
    expect(err.httpStatus).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logRows()[0][1][7]).toBe('failed')
  })

  it('keeps a committed change when only the mirror refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ mutateOperationResponses: [] }))
    refreshMirror.mockRejectedValueOnce(new Error('mirror down'))
    const out = await runMutation(plan(), { adminId: null }, { client: ads() })
    expect(out.committed).toBe(true)
    expect(out.refreshError).toBe('mirror down')
  })

  it('refuses an empty plan', async () => {
    await expect(runMutation({ ...plan(), operations: [] }, { adminId: null }, { client: ads() })).rejects.toThrow('Nothing to change')
  })
})

describe('runLoggedCall (services without validateOnly)', () => {
  it('logs the applied call and refreshes', async () => {
    const r = await runLoggedCall(
      { action: 'recommendation.dismiss', entityType: 'recommendation', entityId: 'r1', summary: 'Dismissed' },
      { adminId: null },
      async () => ({ results: [{ resourceName: 'r1' }] }),
      { client: ads(), refresh: () => ({ recommendations: ['r1'] }) }
    )
    expect(r.value.results).toHaveLength(1)
    expect(logRows()[0][1][7]).toBe('applied')
    expect(refreshMirror).toHaveBeenCalledWith(expect.anything(), { recommendations: ['r1'] })
  })

  it('logs a failure and rethrows it readable', async () => {
    const err = await runLoggedCall({ action: 'merchant.link', entityType: 'merchant_link', summary: 'Link' }, { adminId: null }, async () => {
      throw new Error('nope')
    }).catch(e => e)
    expect(err).toBeInstanceOf(AdsMutationError)
    expect(logRows()[0][1][7]).toBe('failed')
    expect(logRows()[0][1][9]).toBe('nope')
  })
})

describe('explainAdsError', () => {
  it('wraps unknown errors', () => {
    const e = explainAdsError(new Error('socket hang up'), 'commit')
    expect(e).toMatchObject({ stage: 'commit', message: 'socket hang up', httpStatus: 500 })
  })
})

describe('listAdsChanges', () => {
  it('reads the newest changes and caps the limit', async () => {
    queryMany.mockResolvedValueOnce([{ id: '1' }])
    expect(await listAdsChanges(5000)).toEqual([{ id: '1' }])
    expect(queryMany.mock.calls[0][1]).toEqual([500])
  })
})
