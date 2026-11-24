import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ upload: vi.fn(), env: vi.fn() }))
vi.mock('@controller/lib/google-ads/ecom-conversions', () => ({ uploadPendingConversions: h.upload }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsEnvStatus: h.env }))

import { GET } from '@controller/app/api/(internal)/cron/ecom-conversions/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/ecom-conversions', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  h.env.mockReturnValue({ developerToken: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/ecom-conversions', () => {
  it('401s a missing or wrong secret without uploading', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('200s with the upload summary', async () => {
    h.upload.mockResolvedValue({ picked: 2, uploaded: 2, failed: 0, retrying: 0 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ picked: 2, uploaded: 2, failed: 0, retrying: 0 })
  })

  it('200s as skipped when Google Ads is not configured on the platform', async () => {
    h.env.mockReturnValue({ developerToken: false })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_configured' })
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('500s when the upload run throws', async () => {
    h.upload.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
