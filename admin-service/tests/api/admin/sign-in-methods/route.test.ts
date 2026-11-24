import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: vi.fn() }))
vi.mock('@/lib/auth/social/config', () => ({ listSignInMethodsAdmin: vi.fn() }))
vi.mock('@/lib/auth/social/hosts', () => ({ signInHosts: vi.fn(), signInRedirectUris: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/sign-in-methods/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { listSignInMethodsAdmin } from '@/lib/auth/social/config'
import { signInHosts, signInRedirectUris } from '@/lib/auth/social/hosts'

const call = () => GET(new NextRequest('http://localhost/x'))

describe('GET /api/admin/sign-in-methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(credentialOwnerId).mockResolvedValue('owner1' as never)
  })

  it('returns the auth failure without listing (needs settings:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
    expect(listSignInMethodsAdmin).not.toHaveBeenCalled()
  })

  it("lists the owner's methods and the redirect URIs for the store hosts", async () => {
    vi.mocked(listSignInMethodsAdmin).mockResolvedValue([{ provider: 'google', enabled: true }] as never)
    vi.mocked(signInHosts).mockResolvedValue(['shop.example'] as never)
    vi.mocked(signInRedirectUris).mockReturnValue(['https://shop.example/cb'] as never)
    const body = await (await call()).json()
    expect(body).toEqual({ methods: [{ provider: 'google', enabled: true }], redirectUris: ['https://shop.example/cb'] })
    expect(listSignInMethodsAdmin).toHaveBeenCalledWith('owner1')
    expect(signInRedirectUris).toHaveBeenCalledWith(['shop.example'])
  })

  it('returns 500 when listing fails', async () => {
    vi.mocked(listSignInMethodsAdmin).mockRejectedValue(new Error('db'))
    vi.mocked(signInHosts).mockResolvedValue([] as never)
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db')
  })
})
