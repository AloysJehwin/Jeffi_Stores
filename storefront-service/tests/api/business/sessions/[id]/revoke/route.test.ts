import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateBusiness = vi.hoisted(() => vi.fn())
const revokeSession = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateBusiness }))
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeSession }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))

import { POST } from '@storefront/app/api/(public)/business/sessions/[id]/revoke/route'

const post = (id = 's1') =>
  POST(new NextRequest(`http://localhost/api/business/sessions/${id}/revoke`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

describe('POST /api/business/sessions/[id]/revoke', () => {
  beforeEach(() => {
    authenticateBusiness.mockResolvedValue({ userId: 'b1' })
    queryOne.mockResolvedValue({ principal_type: 'business', principal_id: 'b1' })
    revokeSession.mockResolvedValue(undefined)
  })

  it('401s when not a signed-in business', async () => {
    authenticateBusiness.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('404s for an unknown session', async () => {
    queryOne.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('403s for another principal session and never revokes it', async () => {
    queryOne.mockResolvedValue({ principal_type: 'business', principal_id: 'someone-else' })
    expect((await post()).status).toBe(403)
    queryOne.mockResolvedValue({ principal_type: 'customer', principal_id: 'b1' })
    expect((await post()).status).toBe(403)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('revokes the caller own session', async () => {
    const res = await post('s9')
    expect(await res.json()).toEqual({ success: true })
    expect(revokeSession).toHaveBeenCalledWith('s9')
  })

  it('surfaces a revoke failure', async () => {
    revokeSession.mockRejectedValue(new Error('redis'))
    await expect(post()).rejects.toThrow('redis')
  })
})
