import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsEnvStatus: vi.fn(), resolveGoogleAdsCreds: vi.fn() }))
vi.mock('@/lib/google-ads/audiences/refresh', () => ({
  AudienceRefreshInProgressError: class AudienceRefreshInProgressError extends Error {
    constructor() {
      super('Audience lists are already refreshing.')
    }
  },
  refreshAudiences: vi.fn(),
}))

import { GET } from '@admin/app/api/(internal)/cron/google-ads-audiences/route'
import { googleAdsEnvStatus, resolveGoogleAdsCreds } from '@/lib/google-ads/credentials'
import { AudienceRefreshInProgressError, refreshAudiences } from '@/lib/google-ads/audiences/refresh'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/google-ads-audiences', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(resolveGoogleAdsCreds).mockResolvedValue({ developerToken: 'dev-token' } as any)
  vi.mocked(googleAdsEnvStatus).mockReturnValue({ developerToken: false } as any)
})

describe('GET /api/cron/google-ads-audiences', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(refreshAudiences).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the store has no Google Ads connection', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockRejectedValue(new Error('not connected'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(refreshAudiences).not.toHaveBeenCalled()
  })

  it('skips as not_configured when neither the store nor the platform has a developer token', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockResolvedValue({} as any)
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_configured' })
    expect(refreshAudiences).not.toHaveBeenCalled()
  })

  it('rebuilds the enabled Customer Match segments and sends the difference to Google', async () => {
    vi.mocked(refreshAudiences).mockResolvedValue({ status: 'success', segments: [{}, {}] } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', segments: 2 })
    expect(refreshAudiences).toHaveBeenCalledWith()
  })

  it('falls back to the platform developer token when the store has none', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockResolvedValue({} as any)
    vi.mocked(googleAdsEnvStatus).mockReturnValue({ developerToken: true } as any)
    vi.mocked(refreshAudiences).mockResolvedValue({ status: 'success', segments: [] } as any)
    expect(await (await run(OK)).json()).toEqual({ status: 'success', segments: 0 })
  })

  it('skips as running when a refresh is already in progress', async () => {
    vi.mocked(refreshAudiences).mockRejectedValue(new AudienceRefreshInProgressError())
    expect(await (await run(OK)).json()).toEqual({ skipped: 'running' })
  })

  it('500 with the message when Google rejects the refresh', async () => {
    vi.mocked(refreshAudiences).mockRejectedValue(new Error('Google 500'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Google 500' })
  })
})
