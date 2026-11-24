import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateBusiness = vi.hoisted(() => vi.fn())
const revokeAllForPrincipal = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateBusiness }))
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeAllForPrincipal }))

import { POST } from '@storefront/app/api/(public)/business/sessions/revoke-all/route'

const post = () => POST(new NextRequest('http://localhost/api/business/sessions/revoke-all', { method: 'POST' }))

describe('POST /api/business/sessions/revoke-all', () => {
  beforeEach(() => {
    authenticateBusiness.mockResolvedValue({ userId: 'b1' })
    revokeAllForPrincipal.mockResolvedValue(3)
  })

  it('401s when not a signed-in business and revokes nothing', async () => {
    authenticateBusiness.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(revokeAllForPrincipal).not.toHaveBeenCalled()
  })

  it('revokes every session of the caller and reports the count', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ success: true, revoked: 3 })
    expect(revokeAllForPrincipal).toHaveBeenCalledWith('business', 'b1')
  })

  it('surfaces a store failure', async () => {
    revokeAllForPrincipal.mockRejectedValue(new Error('db'))
    await expect(post()).rejects.toThrow('db')
  })
})
