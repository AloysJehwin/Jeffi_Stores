import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/integrations/resolve', () => ({
  googleOAuthAccessToken: vi.fn(async () => ({ token: 'user-token', expiresInSec: 3600, scope: 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager' })),
  googleServiceAccountAccessToken: vi.fn(async () => ({ token: 'sa-token', expiresInSec: 3600 })),
}))

import {
  DATA_MANAGER_BASE,
  DATA_MANAGER_SCOPE,
  DataManagerApiError,
  DataManagerClient,
  SCOPE_MISSING,
  TOKEN_INVALID,
  adsDestination,
  dataManagerClientFor,
  eventIndex,
  hasDataManagerScope,
  parseDataManagerError,
  violationsByEvent,
} from '@/lib/google-ads/conversions/data-manager'
import { googleOAuthAccessToken, googleServiceAccountAccessToken } from '@/lib/integrations/resolve'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const token = (scope?: string) => async () => ({ token: 't', expiresInSec: 3600, ...(scope === undefined ? {} : { scope }) })

beforeEach(() => vi.clearAllMocks())

describe('destinations', () => {
  it('targets the conversion owner, adds the login account only when it differs, and takes the numeric action id', () => {
    expect(adsDestination({ operating: '123-456-7890', login: null, actionId: '777' })).toEqual({
      operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' },
      productDestinationId: '777',
    })
    expect(adsDestination({ operating: '1234567890', login: '1234567890', actionId: '7' })).not.toHaveProperty('loginAccount')
    expect(adsDestination({ operating: '1234567890', login: '999-888-7777', actionId: '7' }).loginAccount).toEqual({
      accountType: 'GOOGLE_ADS',
      accountId: '9998887777',
    })
  })
})

describe('errors', () => {
  it('reads field violations, the request id and the event they point at', () => {
    const e = parseDataManagerError(
      {
        error: {
          code: 400,
          message: 'There was a problem with the request.',
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_ARGUMENT', domain: 'datamanager.googleapis.com', metadata: { requestId: 't-1' } },
            { '@type': 'type.googleapis.com/google.rpc.RequestInfo', requestId: 't-1' },
            {
              '@type': 'type.googleapis.com/google.rpc.BadRequest',
              fieldViolations: [{ field: 'events.events[3].user_data.user_identifiers[1]', description: 'The HEX encoded value is malformed.', reason: 'INVALID_HEX_ENCODING' }],
            },
          ],
        },
      },
      400
    )
    expect(e).toBeInstanceOf(DataManagerApiError)
    expect(e).toMatchObject({ httpStatus: 400, status: 'INVALID_ARGUMENT', reason: null, requestId: 't-1', retryable: false })
    expect(e.code).toBe('INVALID_HEX_ENCODING')
    expect(e.message).toBe('The HEX encoded value is malformed. (INVALID_HEX_ENCODING)')
    expect(eventIndex(e.violations[0].field)).toBe(3)
    expect(violationsByEvent(e.violations, 4)?.get(3)).toHaveLength(1)
    expect(violationsByEvent(e.violations, 2)).toBeNull()
    expect(violationsByEvent([{ field: 'destinations[0].login_account.account_id', reason: 'INVALID_NUMBER_FORMAT', description: '' }], 5)).toBeNull()
    expect(eventIndex('events[0]')).toBe(0)
  })

  it('explains setup problems a store owner or the platform can fix', () => {
    const disabled = parseDataManagerError(
      {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Data Manager API has not been used in project 1 before or it is disabled.',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }],
        },
      },
      403
    )
    expect(disabled.code).toBe('SERVICE_DISABLED')
    expect(disabled.message).toMatch(/Enable datamanager.googleapis.com/)
    const scope = parseDataManagerError(
      {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Request had insufficient authentication scopes.',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
      403
    )
    expect(scope.message).toMatch(/Reconnect Google Ads/)
    expect(parseDataManagerError({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }, 403).message).toMatch(/Standard or Admin access/)
  })

  it('retries transient errors and per-minute quota, not daily quota or bad requests', () => {
    const quota = (limit: string) =>
      parseDataManagerError(
        {
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit: limit } }],
          },
        },
        429
      )
    expect(quota('IngestionMutateRequestsPerMinutePerProject').retryable).toBe(true)
    expect(quota('IngestionMutateRequestsPerDayPerProject')).toMatchObject({ retryable: false, quotaLimit: 'IngestionMutateRequestsPerDayPerProject' })
    expect(parseDataManagerError({ error: { code: 503, status: 'UNAVAILABLE' } }, 503).retryable).toBe(true)
    expect(parseDataManagerError({ error: { code: 500, status: 'INTERNAL' } }, 500).retryable).toBe(true)
    expect(parseDataManagerError({ error: { code: 400, status: 'INVALID_ARGUMENT' } }, 400).retryable).toBe(false)
  })
})

describe('DataManagerClient', () => {
  it('posts events:ingest with a bearer token and returns the request id', async () => {
    const fetchImpl = vi.fn(async () => json(200, { requestId: 'req-9' }))
    const dm = new DataManagerClient({ getAccessToken: token(`${DATA_MANAGER_SCOPE} https://www.googleapis.com/auth/adwords`), fetchImpl: fetchImpl as any })
    const body = { destinations: [adsDestination({ operating: '1', actionId: '2' })], events: [], encoding: 'HEX' as const, validateOnly: true }
    expect(await dm.ingestEvents(body)).toEqual({ requestId: 'req-9' })
    const [url, init] = fetchImpl.mock.calls[0] as any[]
    expect(url).toBe(`${DATA_MANAGER_BASE}/events:ingest`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual(body)
  })

  it('reads a request status by id', async () => {
    const fetchImpl = vi.fn(async () => json(200, { requestStatusPerDestination: [{ requestStatus: 'SUCCESS' }] }))
    const dm = new DataManagerClient({ getAccessToken: token(), fetchImpl: fetchImpl as any })
    await dm.retrieveRequestStatus('a b')
    expect((fetchImpl.mock.calls[0] as any[])[0]).toBe(`${DATA_MANAGER_BASE}/requestStatus:retrieve?requestId=a%20b`)
    expect((fetchImpl.mock.calls[0] as any[])[1].method).toBe('GET')
  })

  it('retries a 503, then gives up with the parsed error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'try later' } }))
      .mockResolvedValueOnce(json(200, { requestId: 'ok' }))
    const dm = new DataManagerClient({ getAccessToken: token(), fetchImpl, retryDelays: [0] })
    expect(await dm.ingestEvents({ destinations: [], events: [], encoding: 'HEX' })).toEqual({ requestId: 'ok' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const bad = vi.fn(async () => json(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'nope' } }))
    const dm2 = new DataManagerClient({ getAccessToken: token(), fetchImpl: bad as any, retryDelays: [0, 0] })
    await expect(dm2.ingestEvents({ destinations: [], events: [], encoding: 'HEX' })).rejects.toMatchObject({ status: 'INVALID_ARGUMENT' })
    expect(bad).toHaveBeenCalledTimes(1)
  })

  it('refuses before calling Google when the token lacks the datamanager scope', async () => {
    const fetchImpl = vi.fn()
    const dm = new DataManagerClient({ getAccessToken: token('https://www.googleapis.com/auth/adwords'), fetchImpl })
    await expect(dm.ingestEvents({ destinations: [], events: [], encoding: 'HEX' })).rejects.toMatchObject({ code: SCOPE_MISSING, status: 'PERMISSION_DENIED' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(hasDataManagerScope(`a ${DATA_MANAGER_SCOPE}`)).toBe(true)
    expect(hasDataManagerScope([DATA_MANAGER_SCOPE])).toBe(true)
    expect(hasDataManagerScope('https://www.googleapis.com/auth/datamanager.partnerlink')).toBe(false)
  })

  it('reports a revoked sign-in as a reconnect', async () => {
    const dm = new DataManagerClient({
      getAccessToken: async () => {
        throw new Error('Google Ads token refresh failed: invalid_grant')
      },
      fetchImpl: vi.fn(),
    })
    await expect(dm.retrieveRequestStatus('r')).rejects.toMatchObject({ code: TOKEN_INVALID, status: 'UNAUTHENTICATED' })
  })

  it('uses the Google Ads refresh token, or the service account with the datamanager scope', async () => {
    const fetchImpl = vi.fn(async () => json(200, {}))
    await dataManagerClientFor({ refreshToken: 'rt' }, { fetchImpl: fetchImpl as any }).retrieveRequestStatus('r')
    expect(googleOAuthAccessToken).toHaveBeenCalledWith('rt', 'Google Ads')
    await dataManagerClientFor({ serviceAccount: { clientEmail: 'sa@x.iam', privateKey: 'k' } }, { fetchImpl: fetchImpl as any }).retrieveRequestStatus('r')
    expect(googleServiceAccountAccessToken).toHaveBeenCalledWith('sa@x.iam', 'k', DATA_MANAGER_SCOPE)
    expect(() => new DataManagerClient({})).toThrow(/refresh token or a service account/)
  })
})
