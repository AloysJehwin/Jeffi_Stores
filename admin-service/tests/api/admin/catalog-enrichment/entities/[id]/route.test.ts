import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/entity-enrichment', () => ({ approveEntityEnrichment: vi.fn(), rejectEntityEnrichment: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/catalog-enrichment/entities/[id]/route'
import { revalidatePath } from 'next/cache'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { approveEntityEnrichment, rejectEntityEnrichment } from '@/lib/catalog/entity-enrichment'

const ctx = { params: Promise.resolve({ id: 'p1' }) }
const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

describe('POST catalog-enrichment/entities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(approveEntityEnrichment).mockResolvedValue({ ok: true, applied: ['description'] } as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ action: 'reject' }), ctx)).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({ action: 'reject' }), ctx)).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'catalog_enrichment:write')
    expect(rejectEntityEnrichment).not.toHaveBeenCalled()
  })

  it('400s on an unknown action', async () => {
    expect((await POST(req({ action: 'nuke' }), ctx)).status).toBe(400)
    expect((await POST(req({}), ctx)).status).toBe(400)
  })

  it('rejects a proposal as the admin', async () => {
    expect(await (await POST(req({ action: 'reject' }), ctx)).json()).toEqual({ ok: true })
    expect(rejectEntityEnrichment).toHaveBeenCalledWith('p1', 'a1')
  })

  it('approves with string fields only and revalidates the admin pages', async () => {
    const res = await POST(req({ action: 'approve', fields: ['description', 5], faqs: false }), ctx)
    expect(await res.json()).toEqual({ ok: true, applied: ['description'] })
    expect(approveEntityEnrichment).toHaveBeenCalledWith('p1', { fields: ['description'], faqs: false, adminId: 'a1' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/brands')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/categories')
  })

  it('409s when the approval fails and skips revalidation', async () => {
    vi.mocked(approveEntityEnrichment).mockResolvedValue({ ok: false, error: 'Already applied' } as any)
    const res = await POST(req({ action: 'approve' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Already applied' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
