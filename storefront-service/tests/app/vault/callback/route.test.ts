import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const consumeVaultTicket = vi.hoisted(() => vi.fn())
const createSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/vault/sso', () => ({ consumeVaultTicket, STATE_COOKIE: 'vault_state' }))
vi.mock('@/lib/auth/auth-sessions', () => ({ createSession }))

import { GET } from '@storefront/app/(vault)/vault/callback/route'

const req = (qs = '', headers: Record<string, string> = {}) =>
  new NextRequest(`https://vault.shop.test/callback${qs}`, { headers })

describe('GET /vault/callback', () => {
  beforeEach(() => {
    consumeVaultTicket.mockResolvedValue({ userId: 'u1', principalType: 'customer', targetPath: '/library/book' })
    createSession.mockResolvedValue({ sid: 'sid-1' })
  })

  it('400s with an expired page when the ticket cannot be consumed (no redirect loop)', async () => {
    consumeVaultTicket.mockResolvedValue(null)
    const res = await GET(req('?t=bad'))
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(await res.text()).toContain('expired')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('passes the ticket and state cookie to the consumer', async () => {
    const withState = req('?t=tok')
    withState.cookies.set('vault_state', 'st1')
    await GET(withState)
    expect(consumeVaultTicket).toHaveBeenCalledWith('tok', 'st1')
    await GET(req())
    expect(consumeVaultTicket).toHaveBeenLastCalledWith('', undefined)
  })

  it('creates a vault session, sets a host-only cookie and redirects to the bound target', async () => {
    const res = await GET(req('?t=tok', { 'x-tenant-id': 'tenant-9', 'user-agent': 'UA/1' }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/library/book')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ principalType: 'vault', principalId: 'u1', role: 'customer', tenantId: 'tenant-9', userAgent: 'UA/1' })
    )
    const cookies = res.headers.getSetCookie().join('\n')
    expect(cookies).toContain('vault_sid=sid-1')
    expect(cookies).toMatch(/HttpOnly/i)
    expect(cookies).not.toMatch(/Domain=/i)
    expect(cookies).toMatch(/vault_state=;/)
  })

  it('propagates a session store failure', async () => {
    createSession.mockRejectedValue(new Error('db down'))
    await expect(GET(req('?t=tok'))).rejects.toThrow('db down')
  })
})
