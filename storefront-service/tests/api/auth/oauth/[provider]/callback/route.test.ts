import { describe, it, expect, vi } from 'vitest'

const socialCallbackGET = vi.hoisted(() => vi.fn())
const socialCallbackPOST = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/social/routes', () => ({ socialCallbackGET, socialCallbackPOST }))

import { GET, POST } from '@storefront/app/api/(public)/auth/oauth/[provider]/callback/route'

type Handler = (r: Request, c: { params: Promise<{ provider: string }> }) => Promise<Response>
const ctx = { params: Promise.resolve({ provider: 'apple' }) }

describe('/api/auth/oauth/[provider]/callback', () => {
  it('GET delegates to the GET callback handler', async () => {
    socialCallbackGET.mockResolvedValue(Response.redirect('http://localhost/account', 302))
    const req = new Request('http://localhost/api/auth/oauth/google/callback?code=c&state=s')
    const res = await (GET as unknown as Handler)(req, ctx)
    expect(res.status).toBe(302)
    expect(socialCallbackGET).toHaveBeenCalledWith(req, ctx)
    expect(socialCallbackPOST).not.toHaveBeenCalled()
  })

  it('POST (Apple form_post) delegates to the POST callback handler', async () => {
    socialCallbackPOST.mockResolvedValue(Response.json({ ok: true }))
    const req = new Request('http://localhost/api/auth/oauth/apple/callback', { method: 'POST' })
    const res = await (POST as unknown as Handler)(req, ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(socialCallbackPOST).toHaveBeenCalledWith(req, ctx)
  })

  it('propagates a handler failure', async () => {
    socialCallbackPOST.mockRejectedValue(new Error('boom'))
    await expect((POST as unknown as Handler)(new Request('http://localhost/x'), ctx)).rejects.toThrow('boom')
  })
})
