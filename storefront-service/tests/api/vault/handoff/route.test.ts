import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateUser = vi.hoisted(() => vi.fn())
const authenticateBusiness = vi.hoisted(() => vi.fn())
const mintVaultTicket = vi.hoisted(() => vi.fn())
const vaultBaseUrlAsync = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateUser, authenticateBusiness }))
vi.mock('@/lib/vault/links', () => ({ vaultBaseUrlAsync }))
vi.mock('@/lib/vault/sso', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vault/sso')>('@/lib/vault/sso')
  return { ...actual, mintVaultTicket }
})
vi.mock('@/lib/shared/redirect', () => ({
  sameHostRedirect: (path: string) => new Response(null, { status: 302, headers: { Location: path } }),
}))

import { GET } from '@storefront/app/api/(public)/vault/handoff/route'

const STATE = 'a'.repeat(64)
const get = (qs: string, host = 'shop.example.com') =>
  GET(new NextRequest(`https://${host}/api/vault/handoff${qs}`, { headers: { host } }))

describe('GET /api/vault/handoff', () => {
  const env = process.env.NODE_ENV
  beforeEach(() => {
    authenticateUser.mockResolvedValue({ userId: 'u1' })
    authenticateBusiness.mockResolvedValue(null)
    mintVaultTicket.mockResolvedValue({ token: 'tok-1' })
    vaultBaseUrlAsync.mockResolvedValue('https://vault.example.com')
  })
  afterEach(() => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = env
  })

  it('bounces to the vault host first when the handoff carries no valid state', async () => {
    const res = await get('?target=/library/x&state=short')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://vault.example.com/library/x')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mintVaultTicket).not.toHaveBeenCalled()
  })

  it('falls back to the default vault path for an unsafe target (no open redirect)', async () => {
    const res = await get('?target=//evil.test/x')
    expect(res.headers.get('location')).toBe('https://vault.example.com/library')
  })

  it('sends a visitor to login with a return path to the handoff', async () => {
    authenticateUser.mockResolvedValue(null)
    const res = await get(`?target=/library/x&state=${STATE}`)
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc.startsWith('/login?redirect=')).toBe(true)
    expect(decodeURIComponent(loc.split('redirect=')[1])).toBe(`/api/vault/handoff?target=${encodeURIComponent('/library/x')}&state=${STATE}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mintVaultTicket).not.toHaveBeenCalled()
  })

  it('mints a single-use ticket for a signed-in customer and redirects to the vault callback', async () => {
    const res = await get(`?target=/library/x&state=${STATE}`)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://vault.example.com/callback?t=tok-1')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mintVaultTicket).toHaveBeenCalledWith({ userId: 'u1', principalType: 'customer', targetPath: '/library/x', state: STATE })
  })

  it('mints a business ticket when only a business is signed in', async () => {
    authenticateUser.mockResolvedValue(null)
    authenticateBusiness.mockResolvedValue({ userId: 'b1' })
    await get(`?state=${STATE}`)
    expect(mintVaultTicket).toHaveBeenCalledWith({ userId: 'b1', principalType: 'business', targetPath: '/library', state: STATE })
  })

  it('keeps the request host under a vault. label in local development', async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    const res = await get(`?state=${STATE}`, 'acme.localhost:3000')
    expect(res.headers.get('location')).toBe('https://vault.localhost:3000/callback?t=tok-1')
    expect(vaultBaseUrlAsync).not.toHaveBeenCalled()
  })

  it('surfaces a ticket store failure', async () => {
    mintVaultTicket.mockRejectedValue(new Error('db'))
    await expect(get(`?state=${STATE}`)).rejects.toThrow('db')
  })
})
