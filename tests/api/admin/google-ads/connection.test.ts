import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(), resolveTenant: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(async () => null),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
  getTenant: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/integrations/resolve', async () => {
  const actual = await vi.importActual<any>('@/lib/integrations/resolve')
  return {
    ...actual,
    googleOAuthAccessToken: vi.fn(async () => ({ token: 'at', expiresInSec: 3600 })),
    googleServiceAccountAccessToken: vi.fn(async () => ({ token: 'sa-at', expiresInSec: 3600 })),
  }
})
vi.mock('@/lib/google-ads/sync', () => ({ isAdsSyncRunning: vi.fn(async () => false) }))
vi.mock('@/lib/shared/google-credentials', () => ({
  loadGoogleServiceAccount: () => ({ client_email: 'sa@jeffi.iam.gserviceaccount.com', private_key: 'pk' }),
}))

import { GET, POST, DELETE } from '@controller/app/api/(admin)/admin/google-ads/connection/route'
import { GET as accounts } from '@controller/app/api/(admin)/admin/google-ads/accounts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { isAdsSyncRunning } from '@/lib/google-ads/sync'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const customer = (extra: Record<string, unknown> = {}) =>
  json([{ results: [{ customer: { id: '1234567890', descriptiveName: 'Acme Ads', currencyCode: 'INR', timeZone: 'Asia/Kolkata', ...extra } }] }])
const post = (body: unknown) =>
  new NextRequest('https://admin-acme.jeffistores.in/api/admin/google-ads/connection', { method: 'POST', body: JSON.stringify(body) })
const pendingRow = {
  status: 'connected',
  config_enc: `enc:${JSON.stringify({ connected_via: 'oauth', oauth_refresh_token: 'rt-user' })}`,
  meta: { connected_via: 'oauth', needs_customer: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'devtok'
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gcid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret'
  process.env.CRON_SECRET = 'x'.repeat(40)
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  delete process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN
  delete process.env.GOOGLE_ADS_CUSTOMER_ID
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
  vi.mocked(getIntegrationCredential).mockResolvedValue(null)
})

describe('connection status', () => {
  it('reports not connected with the env checklist', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const d = await (await GET(new NextRequest('https://x/api/admin/google-ads/connection'))).json()
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(d).toMatchObject({ connected: false, flagship: false, env: { developerToken: false, missing: ['GOOGLE_ADS_DEVELOPER_TOKEN'] } })
  })

  it('shows the flagship connected through the platform service account', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    process.env.GOOGLE_ADS_CUSTOMER_ID = '111-222-3333'
    const d = await (await GET(new NextRequest('https://x/api/admin/google-ads/connection'))).json()
    expect(vi.mocked(getIntegrationCredential).mock.calls[0][0]).toBe(PLATFORM)
    expect(d).toMatchObject({
      connected: true,
      flagship: true,
      connectedVia: 'platform',
      customerId: '1112223333',
      serviceAccountEmail: 'sa@jeffi.iam.gserviceaccount.com',
    })
  })
})

describe('connect', () => {
  it('picks an account after Google sign-in, verifying it first', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(pendingRow as any)
    fetchMock.mockResolvedValueOnce(customer())
    const res = await POST(post({ action: 'select', customerId: '123-456-7890', loginCustomerId: '999-888-7777' }))
    expect(res.status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(fetchMock.mock.calls[0][1].headers['login-customer-id']).toBe('9998887777')
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({
      connected_via: 'oauth',
      oauth_refresh_token: 'rt-user',
      customer_id: '1234567890',
      login_customer_id: '9998887777',
    })
    expect(saved.meta).toMatchObject({ customer_id: '1234567890', account_name: 'Acme Ads', needs_customer: false })
  })

  it('refuses to pick before signing in', async () => {
    const res = await POST(post({ action: 'select', customerId: '1234567890' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Sign in with Google first/)
  })

  it('validates the customer id', async () => {
    const res = await POST(post({ action: 'manual', customerId: '12345', refreshToken: 'x'.repeat(30) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10-digit/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves manual credentials only when Google accepts them', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: 'denied' }] }],
          },
        },
        403
      )
    )
    const res = await POST(post({ action: 'manual', customerId: '1234567890', refreshToken: 'r'.repeat(30) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot access this Google Ads account/)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('rejects a manager account as the reporting account', async () => {
    fetchMock.mockResolvedValueOnce(customer({ manager: true }))
    const res = await POST(post({ action: 'manual', customerId: '1234567890', refreshToken: 'r'.repeat(30) }))
    expect((await res.json()).error).toMatch(/manager account/)
  })

  it('links through the Jeffi manager, inviting the account when not linked yet', async () => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '555-444-3333'
    process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN = 'mgr-rt'
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'no access' } }, 403))
      .mockResolvedValueOnce(json({ result: { resourceName: 'customers/5554443333/customerClientLinks/1234567890~1' } }))
    const res = await POST(post({ action: 'manager', customerId: '1234567890', invite: true }))
    const d = await res.json()
    expect(d).toMatchObject({ ok: true, invited: true })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://googleads.googleapis.com/v26/customers/5554443333/customerClientLinks:mutate')
    expect(JSON.parse(init.body)).toEqual({ operation: { create: { clientCustomer: 'customers/1234567890', status: 'PENDING' } } })
    expect(vi.mocked(saveIntegrationCredential).mock.calls[0][0].meta).toMatchObject({ connected_via: 'manager', link_status: 'invited' })
  })

  it('503s the manager option when Jeffi has no manager configured', async () => {
    const res = await POST(post({ action: 'manager', customerId: '1234567890' }))
    expect(res.status).toBe(503)
  })
})

describe('accounts', () => {
  it('lists direct accounts and expands managers to their clients', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(pendingRow as any)
    fetchMock
      .mockResolvedValueOnce(json({ resourceNames: ['customers/1111111111', 'customers/2222222222'] }))
      .mockResolvedValueOnce(json([{ results: [{ customer: { id: '1111111111', descriptiveName: 'Shop', currencyCode: 'INR' } }] }]))
      .mockResolvedValueOnce(json([{ results: [{ customer: { id: '2222222222', descriptiveName: 'Agency MCC', manager: true } }] }]))
      .mockResolvedValueOnce(
        json([
          {
            results: [
              { customerClient: { id: '3333333333', descriptiveName: 'Client A', manager: false, currencyCode: 'INR', status: 'ENABLED' } },
              { customerClient: { id: '2222222222', descriptiveName: 'Agency MCC', manager: true } },
            ],
          },
        ])
      )
    const d = await (await accounts(new NextRequest('https://x/api/admin/google-ads/accounts'))).json()
    expect(d.accounts).toEqual([
      { customerId: '1111111111', name: 'Shop', currency: 'INR', testAccount: false, loginCustomerId: null, managerName: null },
      { customerId: '3333333333', name: 'Client A', currency: 'INR', testAccount: false, loginCustomerId: '2222222222', managerName: 'Agency MCC' },
    ])
    // The manager's own customer_client list is read on the manager itself.
    expect(fetchMock.mock.calls[3][0]).toBe('https://googleads.googleapis.com/v26/customers/2222222222/googleAds:searchStream')
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).query).toMatch(/FROM customer_client/)
  })
})

describe('disconnect', () => {
  it('waits for a running sync', async () => {
    vi.mocked(isAdsSyncRunning).mockResolvedValueOnce(true)
    const res = await DELETE(new NextRequest('https://x/api/admin/google-ads/connection', { method: 'DELETE' }))
    expect(res.status).toBe(409)
    expect(deleteIntegrationCredential).not.toHaveBeenCalled()
  })

  it('removes only the google_ads credential', async () => {
    const res = await DELETE(new NextRequest('https://x/api/admin/google-ads/connection', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(deleteIntegrationCredential).toHaveBeenCalledWith('t-acme', 'google_ads')
  })
})
