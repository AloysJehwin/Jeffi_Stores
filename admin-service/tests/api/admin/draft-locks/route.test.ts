import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@jeffi/draft-locks', () => ({
  DRAFT_RESOURCES: {
    product: { label: 'Product', readScope: 'products:read', writeScope: 'products:write' },
    brand: { label: 'Brand', readScope: 'brands:read', writeScope: 'brands:write' },
  },
  DRAFT_RESOURCE_TYPES: ['product', 'brand'],
  isDraftListSort: vi.fn(() => false),
  isDraftResourceType: vi.fn((t: string) => t === 'product' || t === 'brand'),
  listDrafts: vi.fn(),
  viewerCounts: vi.fn(),
}))
vi.mock('@jeffi/list-filters', () => ({ normalizeDir: vi.fn((d: string | null) => d ?? 'desc') }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/draft-locks/route'
import { isDraftListSort, listDrafts, viewerCounts } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/draft-locks${qs}`)
const row = (over: any = {}) => ({ resourceType: 'product', resourceId: 'p1', lock: null, ...over })

describe('GET /api/admin/draft-locks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    vi.mocked(listDrafts).mockResolvedValue({ rows: [row()], total: 1 } as any)
    vi.mocked(viewerCounts).mockResolvedValue({ 'product:p1': 2 } as any)
  })

  it('401s without a session (passive)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    expect(authenticateAdmin).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('400s on an unknown type', async () => {
    expect((await GET(req('?type=product,nope'))).status).toBe(400)
    expect(listDrafts).not.toHaveBeenCalled()
  })

  it('limits the types to those the caller can read', async () => {
    vi.mocked(hasScope).mockImplementation(((_r: string, _s: string[], scope: string) => scope === 'brands:read') as any)
    const j = await (await GET(req())).json()
    expect(j.types).toEqual(['brand'])
    expect(j.typeOptions).toEqual([{ value: 'brand', label: 'Brand' }])
    expect(vi.mocked(listDrafts).mock.calls[0][1]).toMatchObject({ scope: 'mine', adminId: 'a1', types: ['brand'], limit: 50, offset: 0 })
  })

  it('passes scope, page and sort through', async () => {
    vi.mocked(isDraftListSort).mockReturnValue(true as any)
    await GET(req('?scope=all&page=3&sort=updated&dir=asc&type=product'))
    expect(vi.mocked(listDrafts).mock.calls[0][1]).toMatchObject({ scope: 'all', offset: 100, types: ['product'], sort: { key: 'updated', dir: 'asc' } })
    await GET(req('?scope=unclaimed&page=zzz'))
    expect(vi.mocked(listDrafts).mock.calls[1][1]).toMatchObject({ scope: 'unclaimed', offset: 0 })
  })

  it('computes the per-row permissions for an unclaimed draft', async () => {
    const j = await (await GET(req())).json()
    expect(j.items[0]).toMatchObject({ typeLabel: 'Product', viewers: 2, isMine: false, canEdit: true, canClaim: true, canTakeOver: false, canDiscard: true })
  })

  it('blocks edit and claim on a draft held by someone else, but lets an owner take over', async () => {
    vi.mocked(listDrafts).mockResolvedValue({ rows: [row({ lock: { ownerId: 'a2', ownerCanEdit: true } })], total: 1 } as any)
    let it0 = (await (await GET(req())).json()).items[0]
    expect(it0).toMatchObject({ canEdit: false, canClaim: false, canTakeOver: false, canDiscard: false })
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    it0 = (await (await GET(req())).json()).items[0]
    expect(it0).toMatchObject({ canTakeOver: true, canDiscard: true })
  })

  it('lets the holder edit and discard their own draft', async () => {
    vi.mocked(listDrafts).mockResolvedValue({ rows: [row({ lock: { ownerId: 'a1', ownerCanEdit: true } })], total: 1 } as any)
    expect((await (await GET(req())).json()).items[0]).toMatchObject({ isMine: true, canEdit: true, canClaim: false, canDiscard: true })
  })

  it('propagates a store failure', async () => {
    vi.mocked(listDrafts).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
