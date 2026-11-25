import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockTenants } = vi.hoisted(() => ({ mockOwner: vi.fn(), mockTenants: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({ getOwnerTenants: mockTenants }))

import { GET } from '@controller/app/api/(ecom)/ecom/auth/me/route'

const req = () => new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/me')

describe('GET /api/ecom/auth/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers a null owner (200) when there is no session', async () => {
    mockOwner.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owner: null })
    expect(mockTenants).not.toHaveBeenCalled()
  })

  it('returns the owner and their tenants', async () => {
    mockOwner.mockResolvedValue({ id: 'o-1', email: 'o@acme.test', name: 'Priya', secret: 'x' })
    mockTenants.mockResolvedValue([{ id: 't-1' }])
    const body = await (await GET(req())).json()
    expect(body).toEqual({ owner: { id: 'o-1', email: 'o@acme.test', name: 'Priya' }, tenants: [{ id: 't-1' }] })
    expect(mockOwner).toHaveBeenCalledWith('sid', {})
    expect(mockTenants).toHaveBeenCalledWith('o-1')
  })
})
