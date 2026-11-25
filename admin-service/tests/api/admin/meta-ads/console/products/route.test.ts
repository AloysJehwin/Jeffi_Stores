import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/meta-ads/creative', () => ({ searchAdProducts: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/meta-ads/console/products/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { searchAdProducts } from '@/lib/meta-ads/creative'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/admin/meta-ads/console/products${qs}`))

describe('GET /api/admin/meta-ads/console/products', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get('?q=shoe')).status).toBe(401)
    expect(searchAdProducts).not.toHaveBeenCalled()
  })

  it('403 without the meta_ads:read scope', async () => {
    deny(403)
    expect((await get('?q=shoe')).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'meta_ads:read')
  })

  it('403 when the plan gate refuses', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
    expect((await get('?q=shoe')).status).toBe(403)
    expect(searchAdProducts).not.toHaveBeenCalled()
  })

  it('returns no products without searching for a query under two characters', async () => {
    for (const qs of ['', '?q=', '?q=a', '?q=%20a%20']) {
      const res = await get(qs)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ products: [] })
    }
    expect(searchAdProducts).not.toHaveBeenCalled()
  })

  it('searches the catalogue with the trimmed query capped at 100 characters', async () => {
    vi.mocked(searchAdProducts).mockResolvedValue([{ id: 'p1' }] as any)
    const res = await get('?q=%20running%20shoe%20')
    expect(await res.json()).toEqual({ products: [{ id: 'p1' }] })
    expect(searchAdProducts).toHaveBeenCalledWith('running shoe')
    await get(`?q=${'x'.repeat(150)}`)
    expect(searchAdProducts).toHaveBeenLastCalledWith('x'.repeat(100))
  })

  it('500 when the search fails', async () => {
    vi.mocked(searchAdProducts).mockRejectedValue(new Error('db down'))
    const res = await get('?q=shoe')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })

  it('409 when Meta is not connected', async () => {
    vi.mocked(searchAdProducts).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect((await get('?q=shoe')).status).toBe(409)
  })
})
