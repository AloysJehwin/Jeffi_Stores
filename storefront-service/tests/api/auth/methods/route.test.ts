import { describe, it, expect, vi } from 'vitest'

const socialMethodsGET = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/social/routes', () => ({ socialMethodsGET }))

import { GET } from '@storefront/app/api/(public)/auth/methods/route'

describe('GET /api/auth/methods', () => {
  it('delegates to the social methods handler', async () => {
    socialMethodsGET.mockResolvedValue(Response.json({ methods: ['google'] }))
    const req = new Request('http://localhost/api/auth/methods')
    const res = await GET(req as never)
    expect(await res.json()).toEqual({ methods: ['google'] })
    expect(socialMethodsGET).toHaveBeenCalledWith(req)
  })

  it('propagates a handler failure', async () => {
    socialMethodsGET.mockRejectedValue(new Error('boom'))
    await expect(GET(new Request('http://localhost/x') as never)).rejects.toThrow('boom')
  })
})
