import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/google-ads/report', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/report')
  return { ...actual, loadTab: vi.fn(async () => ({ campaigns: [] })) }
})
vi.mock('@/lib/google-ads/sync', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/sync')
  return { ...actual, syncGoogleAds: vi.fn(), isAdsSyncRunning: vi.fn(async () => false) }
})
vi.mock('@/lib/google-ads/credentials', () => ({
  resolveGoogleAdsCreds: vi.fn(),
  googleAdsEnvStatus: vi.fn(() => ({ developerToken: true })),
  adsTenantKey: vi.fn(async () => 't1'),
}))
vi.mock('@/lib/integrations/test-connection', () => ({ testGoogleAds: vi.fn(async () => ({ ok: true, message: 'Reached' })) }))
vi.mock('@/lib/google-ads/alerts', () => ({ runAdsAlerts: vi.fn(async () => ({ findings: 0, created: 0, resolved: 0, notified: 0 })) }))

import { GET as report } from '@controller/app/api/(admin)/admin/google-ads/report/route'
import { POST as syncNow, GET as syncStatus } from '@controller/app/api/(admin)/admin/google-ads/sync/route'
import { GET as testConn } from '@controller/app/api/(admin)/admin/google-ads/test/route'
import { GET as cronFull } from '@controller/app/api/(internal)/cron/google-ads-sync/route'
import { GET as cronToday } from '@controller/app/api/(internal)/cron/google-ads-refresh/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { loadTab } from '@/lib/google-ads/report'
import { syncGoogleAds, isAdsSyncRunning, AdsSyncInProgressError } from '@/lib/google-ads/sync'
import { resolveGoogleAdsCreds, googleAdsEnvStatus } from '@/lib/google-ads/credentials'
import { testGoogleAds } from '@/lib/integrations/test-connection'

const SECRET = 'cron-secret-for-tests-0123456789abcdef'
const cronReq = (path: string, auth = `Bearer ${SECRET}`) => new NextRequest(`https://acme.jeffistores.in${path}`, { headers: { authorization: auth } })
const result = (status: string) => ({ mode: 'full', status, range: { from: 'a', to: 'b' }, rows: { campaigns: 1 }, errors: [], startedAt: '', finishedAt: '' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('report API', () => {
  it('reads with google_ads:read and passes a validated range', async () => {
    const res = await report(new NextRequest('https://x/api/admin/google-ads/report?tab=campaigns&from=2026-10-01&to=2026-10-10'))
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(await res.json()).toEqual({ tab: 'campaigns', range: { from: '2026-10-01', to: '2026-10-10' }, data: { campaigns: [] } })
    expect(loadTab).toHaveBeenCalledWith('campaigns', { from: '2026-10-01', to: '2026-10-10' })
  })

  it('rejects unknown tabs', async () => {
    expect((await report(new NextRequest('https://x/api/admin/google-ads/report?tab=edit'))).status).toBe(400)
  })

  it('is closed without the scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await report(new NextRequest('https://x/api/admin/google-ads/report'))).status).toBe(403)
    expect(loadTab).not.toHaveBeenCalled()
  })
})

describe('sync now', () => {
  it('needs google_ads:write and runs a full sync', async () => {
    vi.mocked(syncGoogleAds).mockResolvedValue(result('success') as any)
    const res = await syncNow(new NextRequest('https://x/api/admin/google-ads/sync', { method: 'POST' }))
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(syncGoogleAds).toHaveBeenCalledWith('full')
    expect((await res.json()).status).toBe('success')
  })

  it('409s while another sync runs', async () => {
    vi.mocked(syncGoogleAds).mockRejectedValue(new AdsSyncInProgressError())
    const res = await syncNow(new NextRequest('https://x/api/admin/google-ads/sync', { method: 'POST' }))
    expect(res.status).toBe(409)
  })

  it('reports whether a sync is running', async () => {
    vi.mocked(isAdsSyncRunning).mockResolvedValueOnce(true)
    expect(await (await syncStatus(new NextRequest('https://x/api/admin/google-ads/sync'))).json()).toEqual({ running: true })
  })

  it('tests the connection for the current store', async () => {
    const d = await (await testConn(new NextRequest('https://x/api/admin/google-ads/test'))).json()
    expect(d).toEqual({ ok: true, message: 'Reached' })
    expect(testGoogleAds).toHaveBeenCalledWith('t1')
  })
})

describe('cron', () => {
  it('rejects calls without the cron secret', async () => {
    expect((await cronFull(cronReq('/api/cron/google-ads-sync', 'Bearer nope'))).status).toBe(401)
    expect(syncGoogleAds).not.toHaveBeenCalled()
  })

  it('skips stores that have not connected', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockRejectedValue(new Error('not connected'))
    expect(await (await cronFull(cronReq('/api/cron/google-ads-sync'))).json()).toEqual({ skipped: 'not_connected' })
    expect(syncGoogleAds).not.toHaveBeenCalled()
  })

  it('skips when the platform has no developer token', async () => {
    vi.mocked(googleAdsEnvStatus).mockReturnValueOnce({ developerToken: false } as any)
    expect(await (await cronFull(cronReq('/api/cron/google-ads-sync'))).json()).toEqual({ skipped: 'not_configured' })
  })

  it('runs the nightly full sync and the intraday refresh', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockResolvedValue({} as any)
    vi.mocked(syncGoogleAds).mockResolvedValue(result('success') as any)
    await cronFull(cronReq('/api/cron/google-ads-sync'))
    await cronToday(cronReq('/api/cron/google-ads-refresh'))
    expect(vi.mocked(syncGoogleAds).mock.calls.map(c => c[0])).toEqual(['full', 'today'])
  })

  it('does not fail the fan-out when a run is already in progress', async () => {
    vi.mocked(resolveGoogleAdsCreds).mockResolvedValue({} as any)
    vi.mocked(syncGoogleAds).mockRejectedValue(new AdsSyncInProgressError())
    const res = await cronToday(cronReq('/api/cron/google-ads-refresh'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })
})
