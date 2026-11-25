import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockTenants, mockSave, mockHasToken, mockVerify } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockTenants: vi.fn(),
  mockSave: vi.fn(),
  mockHasToken: vi.fn(),
  mockVerify: vi.fn(),
}))

const TID = '11111111-1111-4111-8111-111111111111'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({ getOwnerTenants: mockTenants, saveIntegrationCredential: mockSave }))
vi.mock('@/lib/integrations/resolve', () => ({ hasOwnDelhiveryToken: mockHasToken }))
vi.mock('@/lib/shipping/delhivery', () => ({ verifyDelhiveryToken: mockVerify }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: (s: string) => `enc(${s})` }))

import { GET as rawGET, PUT as rawPUT } from '@controller/app/api/(ecom)/ecom/delivery-account/route'

// the route's gate union types its early return as possibly undefined; it is always a response
const GET = rawGET as (r: NextRequest) => Promise<Response>
const PUT = rawPUT as (r: NextRequest) => Promise<Response>

const base = 'https://ecom.jeffistores.in/api/ecom/delivery-account'
const put = (body: unknown) => new NextRequest(base, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('/api/ecom/delivery-account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockTenants.mockResolvedValue([{ id: TID, own_delhivery: true }])
    mockHasToken.mockResolvedValue(true)
    mockVerify.mockResolvedValue('valid')
  })

  it('401s signed-out callers and 404s a foreign tenant', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await GET(new NextRequest(`${base}?tenantId=${TID}`))).status).toBe(401)
    mockOwner.mockResolvedValue({ id: 'o-1' })
    expect((await GET(new NextRequest(`${base}?tenantId=other`))).status).toBe(404)
    expect((await GET(new NextRequest(base))).status).toBe(400)
  })

  it('GET reports own account and token state', async () => {
    const body = await (await GET(new NextRequest(`${base}?tenantId=${TID}`))).json()
    expect(body).toEqual({ ownDelhivery: true, tokenConnected: true })
    expect(mockHasToken).toHaveBeenCalledWith(TID)
  })

  it('PUT 400s a short token and 409s a store on the platform account', async () => {
    expect((await PUT(put({ tenantId: TID, token: 'abc' }))).status).toBe(400)
    mockTenants.mockResolvedValue([{ id: TID, own_delhivery: false }])
    expect((await PUT(put({ tenantId: TID, token: 'longenough' }))).status).toBe(409)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('PUT stores the verified token encrypted', async () => {
    const res = await PUT(put({ tenantId: TID, token: 'tok-12345678' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tokenConnected: true })
    expect(mockVerify).toHaveBeenCalledWith('tok-12345678')
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TID, provider: 'delhivery', configEnc: 'enc({"token":"tok-12345678"})' }))
  })

  it('PUT rejects an invalid token (400) and an unreachable Delhivery (502) without saving', async () => {
    mockVerify.mockResolvedValueOnce('invalid')
    expect((await PUT(put({ tenantId: TID, token: 'tok-12345678' }))).status).toBe(400)
    mockVerify.mockResolvedValueOnce('unverified')
    expect((await PUT(put({ tenantId: TID, token: 'tok-12345678' }))).status).toBe(502)
    expect(mockSave).not.toHaveBeenCalled()
  })
})
