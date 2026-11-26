import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

const { mockQuery, mockQueryMany, mockEmbedWithModel } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryMany: vi.fn(),
  mockEmbedWithModel: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ query: mockQuery, queryMany: mockQueryMany }))
vi.mock('@/lib/shared/rag', () => ({ embedWithModel: mockEmbedWithModel, LEGACY_EMBED_MODEL: 'nomic-embed-text' }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn().mockResolvedValue('t-1') }))

import { backfillProductEmbeddings } from '@/lib/shared/embed-products'

const product = { id: 'p1', name: 'Bolt', sku: null, ai_description: null, description: 'steel', ai_use_cases: null, ai_keywords: null, ai_who_uses_it: null, ai_application: null, ai_product_type: null, ai_features: null, ai_search_tags: null, brand_name: null, category_name: null }
const hashOf = (content: string) => crypto.createHash('sha256').update(content).digest('hex')
const CONTENT = 'Bolt\nDescription: steel'

function setup(existing: { source_id: string; content_hash: string | null; embedding_model: string | null }[]) {
  mockQueryMany.mockImplementation(async (sql: string) => (sql.includes('FROM embeddings') ? existing : [product]))
}
const inserts = () => mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO embeddings'))

describe('backfillProductEmbeddings model tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
    mockEmbedWithModel.mockResolvedValue({ vector: [0.1, 0.2], model: 'text-embedding-3-small@768' })
  })

  it('stores the embedding model with every upsert', async () => {
    setup([])
    const r = await backfillProductEmbeddings()
    expect(r).toMatchObject({ total: 1, embedded: 1, skipped: 0, failed: 0 })
    expect(String(inserts()[0][0])).toContain('embedding_model')
    expect(inserts()[0][1]).toEqual(['p1', CONTENT, hashOf(CONTENT), '[0.1,0.2]', 't-1', 'text-embedding-3-small@768'])
  })

  it('skips a row whose hash and model both match the current model', async () => {
    setup([{ source_id: 'p1', content_hash: hashOf(CONTENT), embedding_model: 'text-embedding-3-small@768' }])
    const r = await backfillProductEmbeddings()
    expect(r).toMatchObject({ embedded: 0, skipped: 1 })
    expect(inserts()).toHaveLength(0)
  })

  it('re-embeds a hash-matching row whose model differs, and treats NULL as nomic-embed-text', async () => {
    setup([{ source_id: 'p1', content_hash: hashOf(CONTENT), embedding_model: null }])
    const r = await backfillProductEmbeddings()
    expect(r).toMatchObject({ embedded: 1, skipped: 0 })
    expect(inserts()[0][1][5]).toBe('text-embedding-3-small@768')
  })

  it('skips a NULL-model row while the platform model is still nomic-embed-text', async () => {
    mockEmbedWithModel.mockResolvedValue({ vector: [0.1], model: 'nomic-embed-text' })
    setup([{ source_id: 'p1', content_hash: hashOf(CONTENT), embedding_model: null }])
    expect(await backfillProductEmbeddings()).toMatchObject({ embedded: 0, skipped: 1 })
  })

  it('force re-embeds everything regardless of hash and model', async () => {
    setup([{ source_id: 'p1', content_hash: hashOf(CONTENT), embedding_model: 'text-embedding-3-small@768' }])
    const r = await backfillProductEmbeddings({ force: true })
    expect(r).toMatchObject({ embedded: 1, skipped: 0 })
    expect(mockQueryMany.mock.calls.some(c => String(c[0]).includes('FROM embeddings'))).toBe(false)
  })

  it('counts a failed embed and reports progress for every product', async () => {
    setup([])
    mockEmbedWithModel.mockRejectedValue(new Error('down'))
    const onProgress = vi.fn()
    expect(await backfillProductEmbeddings({ onProgress })).toMatchObject({ failed: 1, embedded: 0 })
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
