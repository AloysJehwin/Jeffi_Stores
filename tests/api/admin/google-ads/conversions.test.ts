import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/google-ads/credentials', () => ({
  googleAdsClientFor: vi.fn(),
  resolveGoogleAdsCreds: vi.fn(),
  googleAdsEnvStatus: vi.fn(() => ({ developerToken: true })),
  adsTenantKey: vi.fn(async () => 't1'),
}))
vi.mock('@/lib/google-ads/conversions/console', () => ({
  listConversionUploads: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 25 })),
  retryFailedUploads: vi.fn(async () => 3),
  loadConversionsSummary: vi.fn(async () => ({ available: true })),
}))
vi.mock('@/lib/google-ads/conversions/actions', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/conversions/actions')
  return {
    ...actual,
    createServerConversionAction: vi.fn(),
    chooseConversionAction: vi.fn(),
    clearConversionAction: vi.fn(async () => {}),
    loadGoogleConversions: vi.fn(async () => ({ actions: [], settings: null, diagnostics: [], errors: [] })),
    setUploadApi: vi.fn(async () => true),
  }
})
vi.mock('@/lib/google-ads/conversions/requests', () => ({
  listDataManagerRequests: vi.fn(async () => [{ requestId: 'r1', status: 'SUCCESS' }]),
}))
vi.mock('@/lib/google-ads/conversions/setup', () => ({
  checkDataManagerSetup: vi.fn(async () => ({ ok: true, code: null, message: 'Google accepted the setup.', warnings: [] })),
}))
vi.mock('@/lib/google-ads/conversions/upload', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/conversions/upload')
  return { ...actual, uploadConversions: vi.fn() }
})

import { GET as log } from '@/app/api/(admin)/admin/google-ads/conversions/route'
import { POST as uploadNow } from '@/app/api/(admin)/admin/google-ads/conversions/upload/route'
import { POST as retry } from '@/app/api/(admin)/admin/google-ads/conversions/retry/route'
import { GET as google } from '@/app/api/(admin)/admin/google-ads/conversions/google/route'
import { POST as setAction, DELETE as clearAction } from '@/app/api/(admin)/admin/google-ads/conversions/action/route'
import { GET as cron } from '@/app/api/(internal)/cron/google-ads-conversions/route'
import { GET as report } from '@/app/api/(admin)/admin/google-ads/report/route'
import { GET as requestsList } from '@/app/api/(admin)/admin/google-ads/conversions/requests/route'
import { POST as settings } from '@/app/api/(admin)/admin/google-ads/conversions/settings/route'
import { POST as check } from '@/app/api/(admin)/admin/google-ads/conversions/check/route'
import { listDataManagerRequests } from '@/lib/google-ads/conversions/requests'
import { checkDataManagerSetup } from '@/lib/google-ads/conversions/setup'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor, resolveGoogleAdsCreds, googleAdsEnvStatus } from '@/lib/google-ads/credentials'
import { listConversionUploads, retryFailedUploads, loadConversionsSummary } from '@/lib/google-ads/conversions/console'
import {
  ConversionActionError,
  chooseConversionAction,
  clearConversionAction,
  createServerConversionAction,
  loadGoogleConversions,
  setUploadApi,
} from '@/lib/google-ads/conversions/actions'
import { uploadConversions, ConversionUploadInProgressError } from '@/lib/google-ads/conversions/upload'
import { GoogleAdsApiError } from '@/lib/google-ads/client'

const SECRET = 'cron-secret-for-tests-0123456789abcdef'
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://acme.jeffistores.in${path}`, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
  })
const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })
const action = { resourceName: 'customers/1234567890/conversionActions/7', name: 'Purchase (server)' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(googleAdsClientFor).mockResolvedValue({ customerId: '1234567890' } as any)
})

describe('upload log', () => {
  it('reads with google_ads:read and passes the filters through', async () => {
    const res = await log(req('/api/admin/google-ads/conversions?status=failed&kind=purchase&q=ORD-1&page=2'))
    expect(res.status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(listConversionUploads).toHaveBeenCalledWith({ status: 'failed', kind: 'purchase', q: 'ORD-1', page: 2, pageSize: 25 })
  })

  it('is closed without the scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(forbidden())
    expect((await log(req('/api/admin/google-ads/conversions'))).status).toBe(403)
    expect(listConversionUploads).not.toHaveBeenCalled()
  })
})

describe('upload now and retry', () => {
  it('runs the job with google_ads:write and reports overlap as 409', async () => {
    vi.mocked(uploadConversions).mockResolvedValueOnce({ status: 'success', uploaded: 2 } as any)
    const ok = await uploadNow(req('/api/admin/google-ads/conversions/upload', { method: 'POST' }))
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(await ok.json()).toMatchObject({ status: 'success', uploaded: 2 })
    vi.mocked(uploadConversions).mockRejectedValueOnce(new ConversionUploadInProgressError())
    expect((await uploadNow(req('/api/admin/google-ads/conversions/upload', { method: 'POST' }))).status).toBe(409)
  })

  it('re-queues all failed rows or the given ids', async () => {
    expect(await (await retry(req('/api/admin/google-ads/conversions/retry', { method: 'POST' }))).json()).toEqual({ retried: 3 })
    expect(retryFailedUploads).toHaveBeenLastCalledWith(null)
    await retry(req('/api/admin/google-ads/conversions/retry', { method: 'POST', body: { ids: [4, 5] } }))
    expect(retryFailedUploads).toHaveBeenLastCalledWith([4, 5])
    expect((await retry(req('/api/admin/google-ads/conversions/retry', { method: 'POST', body: { ids: ['x'] } }))).status).toBe(400)
  })

  it('cannot write with read-only access', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(forbidden())
    expect((await retry(req('/api/admin/google-ads/conversions/retry', { method: 'POST' }))).status).toBe(403)
    expect((await uploadNow(req('/api/admin/google-ads/conversions/upload', { method: 'POST' }))).status).toBe(403)
    expect(retryFailedUploads).not.toHaveBeenCalled()
    expect(uploadConversions).not.toHaveBeenCalled()
  })
})

describe('conversion action', () => {
  it('creates or reuses "Purchase (server)" without automatic retries', async () => {
    vi.mocked(createServerConversionAction).mockResolvedValue({ action, created: true } as any)
    const res = await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'create', primary: true } }))
    expect(await res.json()).toMatchObject({ ok: true, created: true, action })
    expect(googleAdsClientFor).toHaveBeenCalledWith(undefined, { retryDelays: [] })
    expect(createServerConversionAction).toHaveBeenCalledWith(expect.anything(), { primary: true })
  })

  it('selects an existing action and explains a wrong pick', async () => {
    vi.mocked(chooseConversionAction).mockResolvedValueOnce(action as any)
    const ok = await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'select', resourceName: action.resourceName } }))
    expect(ok.status).toBe(200)
    vi.mocked(chooseConversionAction).mockRejectedValueOnce(new ConversionActionError('Pick an import (UPLOAD_CLICKS) action.'))
    const bad = await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'select', resourceName: 'x' } }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/UPLOAD_CLICKS/)
  })

  it('surfaces Google errors and a missing connection', async () => {
    vi.mocked(createServerConversionAction).mockRejectedValueOnce(new GoogleAdsApiError('denied', 403, ['USER_PERMISSION_DENIED'], null, false))
    expect((await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'create' } }))).status).toBe(502)
    vi.mocked(googleAdsClientFor).mockRejectedValueOnce(new Error('Google Ads is not connected'))
    expect((await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'create' } }))).status).toBe(409)
    expect((await setAction(req('/api/admin/google-ads/conversions/action', { method: 'POST', body: { mode: 'nope' } }))).status).toBe(400)
  })

  it('stops uploads on DELETE with write access', async () => {
    expect((await clearAction(req('/api/admin/google-ads/conversions/action', { method: 'DELETE' }))).status).toBe(200)
    expect(clearConversionAction).toHaveBeenCalled()
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
  })
})

describe('live Google data', () => {
  it('loads actions and diagnostics, or 409 when not connected', async () => {
    expect((await google(req('/api/admin/google-ads/conversions/google'))).status).toBe(200)
    expect(loadGoogleConversions).toHaveBeenCalled()
    vi.mocked(googleAdsClientFor).mockRejectedValueOnce(new Error('not connected'))
    expect((await google(req('/api/admin/google-ads/conversions/google'))).status).toBe(409)
  })
})

describe('Data Manager', () => {
  it("lists recent upload requests and Google's status with read access", async () => {
    const res = await requestsList(req('/api/admin/google-ads/conversions/requests?limit=5'))
    expect(await res.json()).toEqual({ requests: [{ requestId: 'r1', status: 'SUCCESS' }] })
    expect(listDataManagerRequests).toHaveBeenCalledWith(5)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
  })

  it('switches the upload API with write access, once an action exists', async () => {
    const ok = await settings(req('/api/admin/google-ads/conversions/settings', { method: 'POST', body: { uploadApi: 'ads_api' } }))
    expect(await ok.json()).toEqual({ ok: true, uploadApi: 'ads_api' })
    expect(setUploadApi).toHaveBeenCalledWith('ads_api')
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect((await settings(req('/api/admin/google-ads/conversions/settings', { method: 'POST', body: { uploadApi: 'ftp' } }))).status).toBe(400)
    vi.mocked(setUploadApi).mockResolvedValueOnce(false)
    expect((await settings(req('/api/admin/google-ads/conversions/settings', { method: 'POST', body: { uploadApi: 'data_manager' } }))).status).toBe(409)
    vi.mocked(requireAdminScope).mockResolvedValue(forbidden())
    expect((await settings(req('/api/admin/google-ads/conversions/settings', { method: 'POST', body: { uploadApi: 'ads_api' } }))).status).toBe(403)
  })

  it('checks the setup with a validate-only upload', async () => {
    const res = await check(req('/api/admin/google-ads/conversions/check', { method: 'POST' }))
    expect(await res.json()).toMatchObject({ ok: true, message: 'Google accepted the setup.' })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    vi.mocked(checkDataManagerSetup).mockRejectedValueOnce(new IntegrationNotConnectedError('google_ads', 't1'))
    expect((await check(req('/api/admin/google-ads/conversions/check', { method: 'POST' }))).status).toBe(409)
    vi.mocked(checkDataManagerSetup).mockRejectedValueOnce(new Error('network'))
    expect((await check(req('/api/admin/google-ads/conversions/check', { method: 'POST' }))).status).toBe(502)
  })
})

describe('report tab', () => {
  it('serves the conversions summary for the range', async () => {
    const res = await report(req('/api/admin/google-ads/report?tab=conversions&from=2026-10-01&to=2026-10-10'))
    expect(await res.json()).toMatchObject({ tab: 'conversions', data: { available: true } })
    expect(loadConversionsSummary).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-10' })
  })
})

describe('cron', () => {
  const cronReq = (auth = `Bearer ${SECRET}`) =>
    new NextRequest('https://acme.jeffistores.in/api/cron/google-ads-conversions', { headers: { authorization: auth } })

  it('rejects calls without the cron secret', async () => {
    expect((await cron(cronReq('Bearer wrong'))).status).toBe(401)
    expect(uploadConversions).not.toHaveBeenCalled()
  })

  it('skips stores that are not configured or not connected', async () => {
    vi.mocked(googleAdsEnvStatus).mockReturnValueOnce({ developerToken: false } as any)
    expect(await (await cron(cronReq())).json()).toEqual({ skipped: 'not_configured' })
    vi.mocked(resolveGoogleAdsCreds).mockRejectedValueOnce(new Error('no'))
    expect(await (await cron(cronReq())).json()).toEqual({ skipped: 'not_connected' })
    expect(uploadConversions).not.toHaveBeenCalled()
  })

  it('runs the upload and reports overlap as a skip', async () => {
    vi.mocked(uploadConversions).mockResolvedValueOnce({ status: 'partial', uploaded: 3, failed: 1, retrying: 0, skipped: 2 } as any)
    expect(await (await cron(cronReq())).json()).toEqual({ status: 'partial', uploaded: 3, failed: 1, retrying: 0, skipped: 2 })
    vi.mocked(uploadConversions).mockRejectedValueOnce(new ConversionUploadInProgressError())
    expect(await (await cron(cronReq())).json()).toEqual({ skipped: 'running' })
  })
})
