import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const revokeSession = vi.fn(async (_sid: string) => {})
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeSession: (sid: string) => revokeSession(sid) }))
vi.mock('@/lib/vault/links', () => ({ storeBaseUrlAsync: async () => 'https://acme.jeffistores.in' }))

import { POST } from '@storefront/app/api/(public)/vault/logout/route'

function req(cookie?: string) {
  const r = new NextRequest('http://vault-acme.localhost/api/vault/logout', { method: 'POST' })
  if (cookie) {
    const [k, v] = cookie.split('=')
    r.cookies.set(k, v)
  }
  return r
}

describe('POST /api/vault/logout', () => {
  it('revokes the vault session, clears the cookie, and points back to the store', async () => {
    const res = await POST(req('vault_sid=abc123'))
    expect(revokeSession).toHaveBeenCalledWith('abc123')
    expect(await res.json()).toEqual({ ok: true, redirect: 'https://acme.jeffistores.in' })
    expect(res.headers.get('set-cookie')).toMatch(/vault_sid=;.*Max-Age=0/i)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('without a cookie still clears and redirects, revoking nothing', async () => {
    const res = await POST(req())
    expect(revokeSession).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('still clears the cookie when revocation fails', async () => {
    revokeSession.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(req('vault_sid=x'))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/vault_sid=/)
  })
})
