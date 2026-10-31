import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/vault/links', () => ({
  vaultItemUrl: vi.fn(async (id: string) => `https://vault.example.com/item/${id}`),
}))

import { GET } from '@storefront/app/api/(public)/vault/owned/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

const PID = '33333333-3333-4333-8333-333333333333'
const req = (pid = PID) => new NextRequest(`http://localhost/api/vault/owned?productId=${pid}`)

describe('GET /api/vault/owned', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 on a bad productId', async () => {
    expect((await GET(req('nope'))).status).toBe(400)
  })

  it('not owned when signed out', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    expect(await (await GET(req())).json()).toEqual({ owned: false, url: null })
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns the vault item URL for an active entitlement', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: 'u-1' } as any)
    vi.mocked(queryOne).mockResolvedValue({ id: 'ent-1' } as any)
    const body = await (await GET(req())).json()
    expect(body).toEqual({ owned: true, url: `https://vault.example.com/item/${PID}` })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['u-1', PID])
  })

  it('not owned without an entitlement', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: 'u-1' } as any)
    vi.mocked(queryOne).mockResolvedValue(null)
    expect(await (await GET(req())).json()).toEqual({ owned: false, url: null })
  })
})
