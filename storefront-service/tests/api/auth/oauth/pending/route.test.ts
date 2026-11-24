import { describe, it, expect, vi } from 'vitest'

const socialPendingGET = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/social/routes', () => ({ socialPendingGET }))

import { GET } from '@storefront/app/api/(public)/auth/oauth/pending/route'

describe('GET /api/auth/oauth/pending', () => {
  it('delegates to the social pending handler', async () => {
    socialPendingGET.mockResolvedValue(Response.json({ pending: null }))
    const req = new Request('http://localhost/api/auth/oauth/pending')
    const res = await GET(req as never)
    expect(await res.json()).toEqual({ pending: null })
    expect(socialPendingGET).toHaveBeenCalledWith(req)
  })

  it('propagates a handler failure', async () => {
    socialPendingGET.mockRejectedValue(new Error('boom'))
    await expect(GET(new Request('http://localhost/x') as never)).rejects.toThrow('boom')
  })
})
