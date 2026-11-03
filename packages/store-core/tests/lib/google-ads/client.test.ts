import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GoogleAdsClient,
  GoogleAdsApiError,
  GoogleAdsNotConfiguredError,
  parseAdsError,
  normalizeCustomerId,
  isValidCustomerId,
  formatCustomerId,
  fromMicros,
} from '@/lib/google-ads/client'

const fetchMock = vi.fn()
const getAccessToken = vi.fn(async () => ({ token: 'at-1', expiresInSec: 3600 }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function adsFailure(category: string, code: string, message: string, status = 403, grpc = 'PERMISSION_DENIED') {
  return {
    error: {
      code: status,
      message: 'The caller does not have permission',
      status: grpc,
      details: [
        {
          '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure',
          errors: [{ errorCode: { [category]: code }, message }],
          requestId: 'req-123',
        },
      ],
    },
  }
}

function client(extra: Record<string, unknown> = {}) {
  return new GoogleAdsClient({
    refreshToken: 'rt',
    customerId: '123-456-7890',
    developerToken: 'dev-tok',
    fetchImpl: fetchMock as any,
    retryDelays: [0, 0],
    getAccessToken,
    ...extra,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  getAccessToken.mockClear()
})

describe('customer ids', () => {
  it('normalizes, validates and formats', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890')
    expect(normalizeCustomerId('customers/1234567890')).toBe('1234567890')
    expect(isValidCustomerId('123-456-7890')).toBe(true)
    expect(isValidCustomerId('12345')).toBe(false)
    expect(formatCustomerId('1234567890')).toBe('123-456-7890')
    expect(fromMicros('2500000')).toBe(2.5)
  })
})

describe('GoogleAdsClient headers', () => {
  it('sends the developer token and bearer token, no login-customer-id for direct access', async () => {
    fetchMock.mockResolvedValue(json([{ results: [] }]))
    await client().searchStream('SELECT customer.id FROM customer')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://googleads.googleapis.com/v26/customers/1234567890/googleAds:searchStream')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer at-1', 'developer-token': 'dev-tok' })
    expect(init.headers['login-customer-id']).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ query: 'SELECT customer.id FROM customer' })
  })

  it('sends login-customer-id (digits only) when acting through a manager', async () => {
    fetchMock.mockResolvedValue(json([{ results: [] }]))
    await client({ loginCustomerId: '999-888-7777' }).searchStream('SELECT customer.id FROM customer')
    expect(fetchMock.mock.calls[0][1].headers['login-customer-id']).toBe('9998887777')
  })

  it('drops a login-customer-id equal to the customer itself', () => {
    expect(client({ loginCustomerId: '1234567890' }).loginCustomerId).toBeNull()
  })

  it('reuses the access token across calls', async () => {
    fetchMock.mockImplementation(async () => json([{ results: [] }]))
    const c = client()
    await c.searchStream('q1')
    await c.searchStream('q2')
    expect(getAccessToken).toHaveBeenCalledTimes(1)
  })

  it('refuses to build without a developer token', () => {
    const prev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    expect(() => new GoogleAdsClient({ refreshToken: 'rt', customerId: '1234567890' })).toThrow(GoogleAdsNotConfiguredError)
    if (prev) process.env.GOOGLE_ADS_DEVELOPER_TOKEN = prev
  })
})

describe('reading', () => {
  it('flattens every searchStream batch', async () => {
    fetchMock.mockResolvedValue(json([{ results: [{ a: 1 }, { a: 2 }] }, { results: [{ a: 3 }] }, { fieldMask: 'x' }]))
    expect(await client().searchStream('q')).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  it('follows nextPageToken on paged search', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ n: 1 }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json({ results: [{ n: 2 }], nextPageToken: 'p3' }))
      .mockResolvedValueOnce(json({ results: [{ n: 3 }] }))
    const rows = await client().search('q')
    expect(rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ query: 'q' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ query: 'q', pageToken: 'p2' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ query: 'q', pageToken: 'p3' })
  })

  it('stops paging at maxPages', async () => {
    fetchMock.mockImplementation(async () => json({ results: [{}], nextPageToken: 'more' }))
    expect((await client().search('q', 2)).length).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lists accessible customers with GET and without login-customer-id', async () => {
    fetchMock.mockResolvedValue(json({ resourceNames: ['customers/1111111111', 'customers/2222222222'] }))
    const ids = await client({ loginCustomerId: '9998887777' }).listAccessibleCustomers()
    expect(ids).toEqual(['1111111111', '2222222222'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://googleads.googleapis.com/v26/customers:listAccessibleCustomers')
    expect(init.method).toBe('GET')
    expect(init.headers['login-customer-id']).toBeUndefined()
    expect(init.headers['developer-token']).toBe('dev-tok')
  })

  it('posts customer-scoped calls for later write paths', async () => {
    fetchMock.mockResolvedValue(json({ results: [] }))
    await client().post(':uploadClickConversions', { conversions: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://googleads.googleapis.com/v26/customers/1234567890:uploadClickConversions')
  })
})

describe('errors and retries', () => {
  it('explains a test-only developer token', async () => {
    fetchMock.mockResolvedValue(
      json(adsFailure('authorizationError', 'DEVELOPER_TOKEN_NOT_APPROVED', 'The developer token is only approved for use with test accounts.'), 403)
    )
    const err = await client().searchStream('q').catch(e => e)
    expect(err).toBeInstanceOf(GoogleAdsApiError)
    expect(err.message).toMatch(/only has test access/)
    expect(err.message).toMatch(/DEVELOPER_TOKEN_NOT_APPROVED/)
    expect(err.codes).toEqual(['DEVELOPER_TOKEN_NOT_APPROVED'])
    expect(err.requestId).toBe('req-123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('explains a permission error and suggests the manager', () => {
    const e = parseAdsError(adsFailure('authorizationError', 'USER_PERMISSION_DENIED', 'User doesn\'t have permission'), 403)
    expect(e.message).toMatch(/cannot access this Google Ads account/)
    expect(e.message).toMatch(/login customer id/)
    expect(e.retryable).toBe(false)
  })

  it('explains a Google account with no Ads account', () => {
    const e = parseAdsError(adsFailure('authenticationError', 'NOT_ADS_USER', 'not associated', 401, 'UNAUTHENTICATED'), 401)
    expect(e.message).toMatch(/not linked to any Google Ads account/)
  })

  it('falls back to Google\'s own message with the code', () => {
    const e = parseAdsError(adsFailure('queryError', 'PROHIBITED_FIELD_COMBINATION', 'Cannot select x with y', 400, 'INVALID_ARGUMENT'), 400)
    expect(e.message).toBe('Cannot select x with y (PROHIBITED_FIELD_COMBINATION)')
  })

  it('handles a plain Google error without GoogleAdsFailure', () => {
    const e = parseAdsError({ error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } }, 401)
    expect(e.message).toMatch(/invalid authentication credentials/)
    expect(e.codes).toEqual(['UNAUTHENTICATED'])
  })

  it('retries 429 and 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json(adsFailure('quotaError', 'RESOURCE_TEMPORARILY_EXHAUSTED', 'slow down', 429, 'RESOURCE_EXHAUSTED'), 429))
      .mockResolvedValueOnce(json({ error: { code: 503, message: 'unavailable', status: 'UNAVAILABLE' } }, 503))
      .mockResolvedValueOnce(json([{ results: [{ ok: 1 }] }]))
    expect(await client().searchStream('q')).toEqual([{ ok: 1 }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after the retry budget', async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: 500, message: 'boom', status: 'INTERNAL' } }, 500))
    const err = await client().searchStream('q').catch(e => e)
    expect(err).toBeInstanceOf(GoogleAdsApiError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('treats an error element inside a 200 searchStream as a failure', async () => {
    fetchMock.mockResolvedValue(json([{ results: [{ a: 1 }] }, adsFailure('authorizationError', 'CUSTOMER_NOT_ENABLED', 'not enabled')]))
    const err = await client({ retryDelays: [] }).searchStream('q').catch(e => e)
    expect(err.message).toMatch(/not enabled/)
  })
})
