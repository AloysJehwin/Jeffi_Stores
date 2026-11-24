import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: vi.fn() }))
vi.mock('@/lib/auth/social/config', () => ({ saveSignInMethod: vi.fn(), removeSignInMethod: vi.fn() }))
vi.mock('@/lib/auth/social/types', () => ({ isSocialProvider: (p: string) => ['google', 'apple'].includes(p) }))

import { PUT, DELETE } from '@admin/app/api/(admin)/admin/sign-in-methods/[provider]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { saveSignInMethod, removeSignInMethod } from '@/lib/auth/social/config'

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) })
const put = (provider: string, body: unknown) =>
  PUT(new NextRequest('http://localhost/x', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(provider))
const del = (provider: string) => DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx(provider))
const denied = () => NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

describe('/api/admin/sign-in-methods/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(credentialOwnerId).mockResolvedValue('owner1' as never)
  })

  describe('PUT', () => {
    it('returns the auth failure without saving (needs settings:write)', async () => {
      vi.mocked(requireAdminScope).mockResolvedValue(denied())
      expect((await put('google', {})).status).toBe(403)
      expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
      expect(saveSignInMethod).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown provider', async () => {
      expect((await put('myspace', { enabled: true })).status).toBe(404)
      expect(saveSignInMethod).not.toHaveBeenCalled()
    })

    it('returns 400 for a non-object body', async () => {
      expect((await put('google', 'nope')).status).toBe(400)
      expect((await put('google', 'null')).status).toBe(400)
    })

    it("saves the owner's app, passing only a boolean for enabled", async () => {
      vi.mocked(saveSignInMethod).mockResolvedValue({ ok: true, method: { provider: 'apple' } } as never)
      const res = await put('apple', { enabled: 'yes', clientId: 'c', clientSecret: 's', teamId: 't', keyId: 'k', privateKey: 'pk' })
      expect(await res.json()).toEqual({ ok: true, method: { provider: 'apple' } })
      expect(saveSignInMethod).toHaveBeenCalledWith('owner1', 'apple', {
        enabled: undefined, clientId: 'c', clientSecret: 's', teamId: 't', keyId: 'k', privateKey: 'pk',
      })
    })

    it('switches a method off with enabled=false', async () => {
      vi.mocked(saveSignInMethod).mockResolvedValue({ ok: true, method: {} } as never)
      await put('google', { enabled: false })
      expect(vi.mocked(saveSignInMethod).mock.calls[0][2]).toMatchObject({ enabled: false })
    })

    it('returns 400 with the validation error from the store', async () => {
      vi.mocked(saveSignInMethod).mockResolvedValue({ ok: false, error: 'Client id required' } as never)
      const res = await put('google', { enabled: true })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Client id required')
    })

    it('returns 500 when saving throws', async () => {
      vi.mocked(saveSignInMethod).mockRejectedValue(new Error('db'))
      expect((await put('google', {})).status).toBe(500)
    })
  })

  describe('DELETE', () => {
    it('returns the auth failure without removing', async () => {
      vi.mocked(requireAdminScope).mockResolvedValue(denied())
      expect((await del('google')).status).toBe(403)
      expect(removeSignInMethod).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown provider', async () => {
      expect((await del('myspace')).status).toBe(404)
    })

    it("removes the owner's app", async () => {
      vi.mocked(removeSignInMethod).mockResolvedValue({ provider: 'google' } as never)
      const res = await del('google')
      expect(await res.json()).toEqual({ ok: true, method: { provider: 'google' } })
      expect(removeSignInMethod).toHaveBeenCalledWith('owner1', 'google')
    })

    it('returns 500 when removal fails', async () => {
      vi.mocked(removeSignInMethod).mockRejectedValue(new Error('db'))
      expect((await del('google')).status).toBe(500)
    })
  })
})
