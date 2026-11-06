import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGated, mockExpiry } = vi.hoisted(() => ({ mockGated: vi.fn(), mockExpiry: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ gatedPrincipal: mockGated }))
vi.mock('@/lib/auth/api-tokens', () => ({ apiTokenExpiry: mockExpiry, storeTenantId: (t: string | null) => t || '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: () => ({ tenantId: 't-acme', slug: 'acme', displayName: 'Acme' }) }))

import { GET } from '@admin/app/api/(admin)/admin/cli/whoami/route'

const get = () => GET(new NextRequest('http://x/api/admin/cli/whoami', { headers: { 'x-forwarded-host': 'admin-acme.jeffistores.in' } }))

beforeEach(() => {
  vi.clearAllMocks()
  mockExpiry.mockResolvedValue('2030-01-01T00:00:00.000Z')
})

describe('GET /api/admin/cli/whoami', () => {
  it('describes a gateway token and the server', async () => {
    mockGated.mockResolvedValue({ kind: 'gateway', via: 'cli', tokenId: 'tok-1', email: 'a@x.in', first_name: 'Ann', role: 'admin', scopes: ['orders:read'], tenantId: 't-acme' })
    const res = await get()
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d).toMatchObject({ kind: 'cli', email: 'a@x.in', role: 'admin', scopes: ['orders:read'], tenant: { id: 't-acme', slug: 'acme', name: 'Acme' }, host: 'admin-acme.jeffistores.in', expiresAt: '2030-01-01T00:00:00.000Z' })
    expect(d.server).toHaveProperty('minCli')
    expect(d.server).toHaveProperty('manifestHash')
  })

  it('a service-account key reports its kind; a cert has no expiry', async () => {
    mockGated.mockResolvedValue({ kind: 'service_account', serviceAccountName: 'feed', role: 'service_account', scopes: [], tenantId: 't-acme' })
    const d = await (await get()).json()
    expect(d).toMatchObject({ kind: 'service_account', name: 'feed', expiresAt: null })
    expect(mockExpiry).not.toHaveBeenCalled()
  })

  it('401 without a credential', async () => {
    mockGated.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })
})
