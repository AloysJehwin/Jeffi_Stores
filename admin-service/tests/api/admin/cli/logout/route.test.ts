import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGated, mockRevoke } = vi.hoisted(() => ({ mockGated: vi.fn(), mockRevoke: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ gatedPrincipal: mockGated }))
vi.mock('@/lib/auth/api-tokens', () => ({ revokeApiToken: mockRevoke }))

import { POST } from '@admin/app/api/(admin)/admin/cli/logout/route'

const post = () => POST(new NextRequest('http://x/api/admin/cli/logout', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  mockRevoke.mockResolvedValue(true)
})

describe('POST /api/admin/cli/logout', () => {
  it('revokes the token the call came with', async () => {
    mockGated.mockResolvedValue({ kind: 'gateway', via: 'cli', tokenId: 'tok-1', adminId: 'a1', tenantId: 't-acme' })
    const res = await post()
    expect(await res.json()).toEqual({ success: true, revoked: true })
    expect(mockRevoke).toHaveBeenCalledWith({ id: 'tok-1', tenantId: 't-acme', adminId: 'a1' })
  })

  it('a session or a service-account key cannot log out this way', async () => {
    mockGated.mockResolvedValue({ kind: 'session', adminId: 'a1', tenantId: null })
    expect((await post()).status).toBe(400)
    mockGated.mockResolvedValue({ kind: 'gateway', via: 'service_account', tokenId: 'tok-2', adminId: 'svc', tenantId: null })
    expect((await post()).status).toBe(400)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('401 without a credential', async () => {
    mockGated.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
})
