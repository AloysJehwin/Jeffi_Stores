// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/ecom/claim: a signed-in owner (no workspace needed) redeems a claim token; each refusal has its own
// status, and a failure never logs the token.

const { resolveOwnerSession, redeemClaim } = vi.hoisted(() => ({ resolveOwnerSession: vi.fn(), redeemClaim: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'owner_sid' ? { value: 'sid' } : undefined) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@controller/lib/outreach/claim', () => ({ redeemClaim }))

import { POST } from '@controller/app/api/(ecom)/ecom/claim/route'

const TOKEN = 'mabc12.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/claim', {
    method: 'POST',
    headers: { host: 'ecom.jeffistores.in', origin: 'https://ecom.jeffistores.in', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('POST /api/ecom/claim', () => {
  beforeEach(() => {
    resolveOwnerSession.mockResolvedValue({ id: 'owner-1', email: 'o@latte.in', name: 'Asha' })
    redeemClaim.mockResolvedValue({ ok: true, siteId: SITE, tenantId: 't-1', already: false })
  })

  it("claims the site for the signed-in owner and points to it on the dashboard", async () => {
    const res = await POST(req({ token: TOKEN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, siteId: SITE, already: false, url: `/dashboard/showcase/${SITE}` })
    expect(resolveOwnerSession).toHaveBeenCalledWith('sid', {})
    expect(redeemClaim).toHaveBeenCalledWith(TOKEN, 'owner-1')
  })

  it('401s without an owner session', async () => {
    resolveOwnerSession.mockResolvedValue(null)
    expect((await POST(req({ token: TOKEN }))).status).toBe(401)
    expect(redeemClaim).not.toHaveBeenCalled()
  })

  it("403s a post from another site's page", async () => {
    expect((await POST(req({ token: TOKEN }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect(redeemClaim).not.toHaveBeenCalled()
  })

  it('400s a missing, oversized or unreadable token', async () => {
    for (const body of [{}, { token: 5 }, { token: '' }, { token: 'x'.repeat(300) }, 'not json']) expect((await POST(req(body))).status).toBe(400)
    expect(redeemClaim).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', 400],
    ['expired', 410],
    ['used', 409],
    ['no_site', 404],
  ])('answers %s with %i', async (code, status) => {
    redeemClaim.mockResolvedValue({ ok: false, code, error: `It is ${code}.` })
    const res = await POST(req({ token: TOKEN }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: `It is ${code}.`, code })
  })

  it('500s on a failure without logging the token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    redeemClaim.mockRejectedValue(new Error('db down'))
    const res = await POST(req({ token: TOKEN }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })
})
