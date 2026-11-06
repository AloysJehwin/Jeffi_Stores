import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockSignedIn, mockList, mockCreate, mockQueryMany } = vi.hoisted(() => ({ mockSignedIn: vi.fn(), mockList: vi.fn(), mockCreate: vi.fn(), mockQueryMany: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ signedInAdmin: mockSignedIn }))
vi.mock('@/lib/auth/api-tokens', async importOriginal => ({ ...(await importOriginal<object>()), listApiTokens: mockList, createAdminToken: mockCreate }))
vi.mock('@/lib/shared/db', () => ({ queryMany: mockQueryMany }))

import { GET, POST } from '@admin/app/api/(admin)/admin/cli/tokens/route'

const ADMIN = { kind: 'session', adminId: 'a1', role: 'admin', scopes: ['products:write'], tenantId: 't-acme' }
const TOKEN = { id: 't1', kind: 'cli', adminId: 'a1', serviceAccountId: null, status: 'active', expired: false, scopes: ['*'] }

beforeEach(() => {
  vi.clearAllMocks()
  mockSignedIn.mockResolvedValue(ADMIN)
  mockList.mockResolvedValue([TOKEN])
  mockQueryMany.mockResolvedValue([{ id: 'a1', email: 'a@x.in', first_name: 'Ann', last_name: null }])
  mockCreate.mockResolvedValue({ id: 't2', token: 'jfc_new', prefix: 'jfc_new', expiresAt: '2030-01-01T00:00:00.000Z' })
})

describe('GET /api/admin/cli/tokens', () => {
  it("lists the admin's own tokens", async () => {
    const res = await GET(new NextRequest('http://x/api/admin/cli/tokens?all=1'))
    const d = await res.json()
    expect(mockList).toHaveBeenCalledWith({ tenantId: 't-acme', adminId: 'a1', serviceAccounts: false })
    expect(d.all).toBe(false)
    expect(d.tokens[0]).toMatchObject({ id: 't1', holder: 'Ann', mine: true, live: true })
  })

  it("lets the store's owner see everyone's, service-account keys included", async () => {
    mockSignedIn.mockResolvedValue({ ...ADMIN, role: 'super_admin' })
    await GET(new NextRequest('http://x/api/admin/cli/tokens?all=1'))
    expect(mockList).toHaveBeenCalledWith({ tenantId: 't-acme', adminId: undefined, serviceAccounts: true })
  })

  it('needs a session', async () => {
    mockSignedIn.mockResolvedValue(null)
    expect((await GET(new NextRequest('http://x/api/admin/cli/tokens'))).status).toBe(401)
  })
})

describe('POST /api/admin/cli/tokens', () => {
  const post = (body: unknown) => POST(new NextRequest('http://x/api/admin/cli/tokens', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-host': 'admin-acme.jeffistores.in' } }))

  it('mints an extension token within the grant, shown once', async () => {
    const res = await post({ kind: 'extension', scopes: ['products:write'], ttl: '24h' })
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ token: 'jfc_new', scopes: ['products:write'], kind: 'extension' })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'extension', adminId: 'a1', scopes: ['products:write'], ttlSeconds: 86400 }))
  })

  it('refuses a scope the admin lacks or an unknown kind', async () => {
    expect((await post({ kind: 'extension', scopes: ['orders:write'] })).status).toBe(400)
    expect((await post({ kind: 'service_account', scopes: ['products:write'] })).status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
