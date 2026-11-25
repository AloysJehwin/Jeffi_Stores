import { describe, it, expect, vi } from 'vitest'

const socialStartGET = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/social/routes', () => ({ socialStartGET }))

import { GET } from '@storefront/app/api/(public)/auth/oauth/[provider]/start/route'

describe('GET /api/auth/oauth/[provider]/start', () => {
  it('delegates to the social start handler with the provider params', async () => {
    socialStartGET.mockResolvedValue(Response.redirect('https://accounts.example/auth', 302))
    const req = new Request('http://localhost/api/auth/oauth/google/start')
    const ctx = { params: Promise.resolve({ provider: 'google' }) }
    const res = await (GET as unknown as (r: Request, c: typeof ctx) => Promise<Response>)(req, ctx)
    expect(res.status).toBe(302)
    expect(socialStartGET).toHaveBeenCalledWith(req, ctx)
  })

  it('propagates a handler failure', async () => {
    socialStartGET.mockRejectedValue(new Error('boom'))
    await expect((GET as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/x'))).rejects.toThrow('boom')
  })
})
