import { describe, it, expect, vi } from 'vitest'

const socialCompletePOST = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/social/routes', () => ({ socialCompletePOST }))

import { POST } from '@storefront/app/api/(public)/auth/oauth/complete/route'

describe('POST /api/auth/oauth/complete', () => {
  it('delegates to the social complete handler', async () => {
    socialCompletePOST.mockResolvedValue(Response.json({ ok: true }))
    const req = new Request('http://localhost/api/auth/oauth/complete', { method: 'POST' })
    const res = await POST(req as never)
    expect(await res.json()).toEqual({ ok: true })
    expect(socialCompletePOST).toHaveBeenCalledWith(req)
  })

  it('propagates a handler failure', async () => {
    socialCompletePOST.mockRejectedValue(new Error('boom'))
    await expect(POST(new Request('http://localhost/x', { method: 'POST' }) as never)).rejects.toThrow('boom')
  })
})
