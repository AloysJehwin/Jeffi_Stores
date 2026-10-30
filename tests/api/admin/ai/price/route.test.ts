import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ query: vi.fn(), ownerId: vi.fn() }))

vi.mock('@/lib/auth/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await import('@/lib/auth/scopes')
  const authenticateAdmin = vi.fn()
  return {
    authenticateAdmin,
    requireAdminScope: vi.fn(async (req: unknown, scope: string) => {
      const a = await authenticateAdmin(req)
      if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!hasScope(a.role, a.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      return a
    }),
  }
})
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: h.query }) }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: h.ownerId, isPlatformOwner: (id: string) => id === 'platform' }))

import { GET } from '@controller/app/api/(admin)/admin/ai/price/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'

const ADMIN = { adminId: 'a1', role: 'staff', scopes: ['social:write', 'catalog_enrichment:write'] }
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/ai/price?${qs}`))
const ROWS = [
  { provider: 'google', model: 'imagen-4', price_inr: '6' },
  { provider: 'replicate', model: '*', price_inr: '4' },
  { provider: 'razer', model: 'sdxl', price_inr: '1.5' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  h.ownerId.mockResolvedValue('tenant-1')
  h.query.mockResolvedValue({ rows: ROWS })
})

describe('GET /api/admin/ai/price', () => {
  it('quotes the preferred provider for the quality', async () => {
    expect(await (await get('feature=social_image&quality=draft')).json()).toMatchObject({ priceInr: 1.5, unitType: 'image', provider: 'razer' })
    expect(await (await get('feature=social_image&quality=premium')).json()).toMatchObject({ priceInr: 6, provider: 'google' })
    expect(await (await get('feature=social_image')).json()).toMatchObject({ priceInr: 4 })
  })

  it('quotes per video second for video features', async () => {
    const j = await (await get('feature=social_video')).json()
    expect(j.unitType).toBe('video_second')
    expect(h.query).toHaveBeenCalledWith(expect.any(String), ['video', 'video_second'])
  })

  it('quotes 0 on the flagship without reading the price list', async () => {
    h.ownerId.mockResolvedValue('platform')
    expect(await (await get('feature=social_image')).json()).toMatchObject({ priceInr: 0, charged: false })
    expect(h.query).not.toHaveBeenCalled()
  })

  it('returns a null price when the list is empty', async () => {
    h.query.mockResolvedValue({ rows: [] })
    expect((await (await get('feature=social_image')).json()).priceInr).toBeNull()
  })

  it('gates on the feature scope, the AI scope and the plan', async () => {
    expect((await get('feature=product_image')).status).toBe(403)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, plan: 'basic', upgradeRequired: 'pro' })
    expect((await get('feature=social_image')).status).toBe(403)
  })

  it('400s an unknown feature', async () => {
    expect((await get('feature=nope')).status).toBe(400)
  })
})
