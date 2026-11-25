import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/google-ads/report', () => ({ getAdsAccount: vi.fn() }))
vi.mock('@/lib/google-ads/digest', () => ({ sendWeeklyDigest: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/google-ads-digest/route'
import { getAdsAccount } from '@/lib/google-ads/report'
import { sendWeeklyDigest } from '@/lib/google-ads/digest'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/google-ads-digest', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(getAdsAccount).mockResolvedValue({ last_sync_at: '2026-01-05' } as any)
})

describe('GET /api/cron/google-ads-digest', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(sendWeeklyDigest).not.toHaveBeenCalled()
  })

  it('skips as no_data when the account has never synced (or there is no account)', async () => {
    vi.mocked(getAdsAccount).mockResolvedValueOnce({ last_sync_at: null } as any)
    expect(await (await run(OK)).json()).toEqual({ skipped: 'no_data' })
    vi.mocked(getAdsAccount).mockResolvedValueOnce(null as any)
    expect(await (await run(OK)).json()).toEqual({ skipped: 'no_data' })
    expect(sendWeeklyDigest).not.toHaveBeenCalled()
  })

  it('sends the weekly digest (mail is mocked) and returns its result', async () => {
    vi.mocked(sendWeeklyDigest).mockResolvedValue({ sent: 2 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 2 })
    expect(sendWeeklyDigest).toHaveBeenCalledWith()
  })

  it('500 with the message when sending fails', async () => {
    vi.mocked(sendWeeklyDigest).mockRejectedValue(new Error('SES down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'SES down' })
  })
})
