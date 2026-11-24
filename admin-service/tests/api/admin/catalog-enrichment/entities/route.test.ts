import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/catalog/entity-enrichment', () => ({
  ENTITY_AI_FIELDS: { brand: { description: 'auto' }, category: {} },
  entitiesNeedingEnrichment: vi.fn(),
  entityEnrichmentContext: vi.fn(),
  proposeEntityEnrichment: vi.fn(),
  specFor: vi.fn((_t: string, k: string) => (k === 'description' ? { label: 'Description' } : null)),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/catalog-enrichment/entities/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { entitiesNeedingEnrichment, entityEnrichmentContext, proposeEntityEnrichment } from '@/lib/catalog/entity-enrichment'

const get = (qs = '') => new NextRequest(`http://localhost/api/admin/catalog-enrichment/entities${qs}`)
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/catalog-enrichment/entities', { method: 'POST', body: JSON.stringify(body) })

describe('catalog-enrichment/entities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(entityEnrichmentContext).mockResolvedValue({ tenant: 't' } as any)
    vi.mocked(proposeEntityEnrichment).mockResolvedValue(undefined as any)
  })
  afterEach(() => vi.useRealTimers())

  it('401s and 403s on both methods', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(get())).status).toBe(401)
    expect((await POST(post({}))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(get())).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('m', [], 'catalog_enrichment:read')
    expect((await POST(post({ type: 'brand' }))).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('m', [], 'catalog_enrichment:write')
  })

  it('GET maps rows to proposals with current values and filters', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      {
        id: 'p1', entity_type: 'brand', entity_id: 'b1', entity_name: 'Acme', entity_slug: 'acme', status: 'proposed', error: null, model: 'm',
        proposed_at: 't', faqs: null, fields: { description: 'New', other: 'x' }, sources: { description: 'web' }, current: { description: 'Old' },
      },
    ] as any)
    const j = await (await GET(get('?type=brand'))).json()
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['brand', 'proposed'])
    expect(j.proposals[0].faqs).toEqual([])
    expect(j.proposals[0].fields).toEqual([
      { key: 'description', label: 'Description', role: 'auto', value: 'New', current: 'Old', source: 'web' },
      { key: 'other', label: 'other', role: 'suggest', value: 'x', current: null, source: null },
    ])
    await GET(get('?type=bogus&status=all'))
    expect(vi.mocked(queryMany).mock.calls[1][1]).toEqual([null, 'all'])
  })

  it('POST 400s on a bad type', async () => {
    expect((await POST(post({ type: 'product' }))).status).toBe(400)
  })

  it('POST reports nothing queued when no entity needs enrichment', async () => {
    vi.mocked(entitiesNeedingEnrichment).mockResolvedValue([])
    const j = await (await POST(post({ type: 'category' }))).json()
    expect(j.queued).toBe(0)
    expect(j.message).toContain('categories')
    expect(entityEnrichmentContext).not.toHaveBeenCalled()
  })

  it('POST queues the given ids and proposes the first immediately', async () => {
    const res = await POST(post({ type: 'brand', ids: ['b1', 'b2'] }))
    const j = await res.json()
    expect(j.queued).toBe(2)
    expect(entitiesNeedingEnrichment).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(proposeEntityEnrichment).toHaveBeenCalledWith('brand', 'b1', { tenant: 't' }))
  })

  it('POST falls back to entities needing enrichment and survives a propose failure', async () => {
    vi.mocked(entitiesNeedingEnrichment).mockResolvedValue(['c1'])
    vi.mocked(proposeEntityEnrichment).mockRejectedValue(new Error('ai down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(post({ type: 'category' }))
    expect((await res.json()).queued).toBe(1)
    expect(entitiesNeedingEnrichment).toHaveBeenCalledWith('category', 200)
    await vi.waitFor(() => expect(err).toHaveBeenCalled())
  })
})
