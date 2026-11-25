import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn((a: any) => ({ adminId: a.adminId })),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 3),
}))
vi.mock('@/lib/admin/draft-branches', () => ({ draftConflictResponse: vi.fn(), getDraftRow: vi.fn() }))
vi.mock('@/lib/catalog/brand-draft', () => ({ brandDrafts: { name: 'bd' }, publishBrandDraft: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/brands/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { draftLockResponse } from '@/lib/admin/draft-locks'
import { draftConflictResponse, getDraftRow } from '@/lib/admin/draft-branches'
import { publishBrandDraft } from '@/lib/catalog/brand-draft'

const ctx = { params: Promise.resolve({ id: 'b1' }) }
const req = (body: unknown = {}, qs = '?draft=d1') => new NextRequest(`http://localhost/api/admin/brands/b1/publish${qs}`, { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/admin/brands/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getDraftRow).mockResolvedValue({ brand_id: 'b1' } as any)
    vi.mocked(publishBrandDraft).mockResolvedValue({ revision: 4 } as any)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
    vi.mocked(draftConflictResponse).mockReturnValue(null as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'brands:write')
    expect(publishBrandDraft).not.toHaveBeenCalled()
  })

  it('400s without a draft id and 404s for a foreign draft', async () => {
    expect((await POST(req({}, ''), ctx)).status).toBe(400)
    vi.mocked(getDraftRow).mockResolvedValue({ brand_id: 'other' } as any)
    expect((await POST(req(), ctx)).status).toBe(404)
  })

  it('publishes, taking the draft id from the body when not in the query', async () => {
    const res = await POST(req({ draftId: 'd9', resolutions: { name: 'draft' } }, ''), ctx)
    expect(await res.json()).toEqual({ success: true, brandId: 'b1', revision: 4 })
    expect(publishBrandDraft).toHaveBeenCalledWith('d9', { actor: { adminId: 'a1' }, resolutions: { name: 'draft' }, epoch: 3 })
  })

  it('returns lock and conflict responses', async () => {
    vi.mocked(publishBrandDraft).mockRejectedValueOnce(new Error('x'))
    vi.mocked(draftConflictResponse).mockReturnValueOnce(NextResponse.json({ conflicts: [] }, { status: 409 }) as any)
    expect((await POST(req(), ctx)).status).toBe(409)
    vi.mocked(publishBrandDraft).mockRejectedValueOnce(new Error('x'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
    expect((await POST(req(), ctx)).status).toBe(423)
  })

  it('500s with the error message on other failures', async () => {
    vi.mocked(publishBrandDraft).mockRejectedValue(new Error('db down'))
    const res = await POST(req(), ctx)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })
})
