import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn(async () => ({ adminId: 'a1' })) }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(), resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(async () => null),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
  getTenant: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/meta-ads/connection/route'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const TOKEN = 'EAAB-system-user-token-1234567890'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.META_APP_ID
  delete process.env.META_APP_SECRET
  vi.mocked(resolveTenantId).mockResolvedValue(null)
  vi.mocked(getIntegrationCredential).mockResolvedValue(null)
  fetchMock.mockResolvedValue(json({ data: [{ id: 'act_99', name: 'Jeffi Ads', currency: 'INR', account_status: 1 }] }))
})

describe('Meta Ads manual connection without the platform app', () => {
  it('connects a system user token and ad account with no META_APP_ID / SECRET', async () => {
    const status = await (await GET(new NextRequest('https://x/api/admin/meta-ads/connection'))).json()
    expect(status).toMatchObject({ envReady: false, connected: false, oauth: { enabled: false } })

    const r = await POST(
      new NextRequest('https://x/api/admin/meta-ads/connection', {
        method: 'POST',
        body: JSON.stringify({ accessToken: TOKEN, adAccountId: '99' }),
      })
    )
    expect(r.status).toBe(200)
    const call = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(call.tenantId).toBe(PLATFORM)
    expect(JSON.parse(call.configEnc.replace(/^enc:/, ''))).toMatchObject({
      access_token: TOKEN,
      ad_account_id: 'act_99',
      connected_via: 'manual',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('graph.facebook.com')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('client_secret')
  })
})
