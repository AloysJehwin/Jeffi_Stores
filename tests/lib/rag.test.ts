import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockClientQuery, mockClientRelease, mockPoolConnect, mockPoolOn } = vi.hoisted(() => {
  const mockClientRelease = vi.fn()
  const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] })
  const mockPoolConnect = vi.fn().mockResolvedValue({ query: mockClientQuery, release: mockClientRelease })
  const mockPoolOn = vi.fn()
  return { mockClientQuery, mockClientRelease, mockPoolConnect, mockPoolOn }
})

vi.mock('pg', () => {
  // Must use `function` so `new Pool(...)` works (arrow functions are not constructible)
  function Pool(this: any) {
    this.connect = mockPoolConnect
    this.on = mockPoolOn
  }
  return { Pool }
})

vi.mock('@/lib/shared/ai-client', () => ({ aiEmbed: vi.fn() }))

// Tenant resolver drives RAG isolation (#489): default null = platform/off-tenant.
const { mockResolveTenantId } = vi.hoisted(() => ({ mockResolveTenantId: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: mockResolveTenantId }))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  embed,
  findSimilar,
  findSimilarProducts,
  findSimilarProductIds,
  findSimilarCustomers,
  queryManyReplica,
} from '@/lib/shared/rag'
import { aiEmbed } from '@/lib/shared/ai-client'

const mockAiEmbed = vi.mocked(aiEmbed)

const MOCK_VEC = [0.1, 0.2, 0.3]

// ── Tests: embed ──────────────────────────────────────────────────────────────

describe('embed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the gateway embedding on success', async () => {
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
    const result = await embed('hello')
    expect(result).toEqual(MOCK_VEC)
    expect(mockAiEmbed).toHaveBeenCalledWith('hello')
  })

  it('propagates a gateway error', async () => {
    mockAiEmbed.mockRejectedValue(new Error('AI gateway embed HTTP 500'))
    await expect(embed('hello')).rejects.toThrow('AI gateway embed HTTP 500')
  })

  it('throws when the gateway returns no embedding', async () => {
    mockAiEmbed.mockResolvedValue([])
    await expect(embed('hello')).rejects.toThrow('Gateway embed response missing embedding array')
  })

  it('throws when the embedding is not an array', async () => {
    mockAiEmbed.mockResolvedValue(['not-array' as unknown as number[]])
    await expect(embed('hello')).rejects.toThrow('Gateway embed response missing embedding array')
  })
})

// ── Tests: findSimilar ────────────────────────────────────────────────────────

describe('findSimilar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
  })

  it('returns empty array when no results', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] })
    const results = await findSimilar('test query')
    expect(results).toEqual([])
  })

  it('handles no options (no tables filter, no minSimilarity)', async () => {
    mockClientQuery.mockResolvedValue({
      rows: [
        { source_table: 'products', source_id: 'p1', content: 'Product 1', similarity: 0.9, metadata: { name: 'P1' } },
      ],
    })
    const results = await findSimilar('test')
    expect(results).toHaveLength(1)
    expect(results[0].similarity).toBe(0.9)
    expect(results[0].metadata).toEqual({ name: 'P1' })
  })

  it('filters by sourceTables', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] })
    const results = await findSimilar('test', { sourceTables: ['products', 'product_variants'] })
    expect(results).toEqual([])
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('SET LOCAL'))
  })

  it('filters by sourceTable (singular)', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] })
    const results = await findSimilar('test', { sourceTable: 'users' })
    expect(results).toEqual([])
  })

  it('filters by minSimilarity', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] })
    const results = await findSimilar('test', { minSimilarity: 0.7 })
    expect(results).toEqual([])
  })

  it('parses similarity when returned as string and defaults metadata null to {}', async () => {
    mockClientQuery.mockResolvedValue({
      rows: [{ source_table: 'products', source_id: 'p1', content: 'P1', similarity: '0.85', metadata: null }],
    })
    const results = await findSimilar('test')
    expect(results[0].similarity).toBe(0.85)
    expect(results[0].metadata).toEqual({})
  })

  it('uses numeric similarity directly when already a number', async () => {
    mockClientQuery.mockResolvedValue({
      rows: [{ source_table: 'products', source_id: 'p1', content: 'P1', similarity: 0.75, metadata: {} }],
    })
    const results = await findSimilar('test')
    expect(results[0].similarity).toBe(0.75)
  })

  it('respects custom limit', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] })
    const results = await findSimilar('test', { limit: 5 })
    expect(results).toEqual([])
  })
})

// ── Tests: findSimilarProducts ────────────────────────────────────────────────

describe('findSimilarProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  it('delegates to findSimilar with products/variants tables', async () => {
    const results = await findSimilarProducts('bolt')
    expect(results).toEqual([])
  })

  it('uses provided limit', async () => {
    const results = await findSimilarProducts('bolt', 3)
    expect(results).toEqual([])
  })
})

// ── Tests: findSimilarProductIds ──────────────────────────────────────────────

describe('findSimilarProductIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
  })

  it('returns empty array when no results', async () => {
    mockClientQuery.mockImplementation(async () => ({ rows: [] }))
    const results = await findSimilarProductIds('test')
    expect(results).toEqual([])
  })

  it('returns product matches sorted by similarity descending', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'products'"))
        return {
          rows: [
            { source_id: 'p1', similarity: 0.9 },
            { source_id: 'p2', similarity: 0.7 },
          ],
        }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test')
    expect(results).toHaveLength(2)
    expect(results[0].productId).toBe('p1')
    expect(results[0].similarity).toBe(0.9)
    expect(results[0].matchedVia).toBe('products')
    expect(results[0].variantId).toBeNull()
    expect(results[1].productId).toBe('p2')
  })

  it('includes variant matches', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'product_variants'")) return { rows: [{ source_id: 'var-1', similarity: 0.8 }] }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test')
    expect(results).toHaveLength(1)
    expect(results[0].matchedVia).toBe('product_variants')
    expect(results[0].variantId).toBe('var-1')
    expect(results[0].productId).toBe('')
  })

  it('parses string similarity values in both product and variant rows', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'products'")) return { rows: [{ source_id: 'p1', similarity: '0.88' }] }
      if (sql.includes("source_table = 'product_variants'"))
        return { rows: [{ source_id: 'var-1', similarity: '0.77' }] }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test')
    const pResult = results.find(r => r.matchedVia === 'products')
    const vResult = results.find(r => r.matchedVia === 'product_variants')
    expect(pResult?.similarity).toBe(0.88)
    expect(vResult?.similarity).toBe(0.77)
  })

  it('deduplicates products by productId (second occurrence skipped)', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'products'"))
        return {
          rows: [
            { source_id: 'p1', similarity: 0.9 },
            { source_id: 'p1', similarity: 0.8 }, // duplicate
          ],
        }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test')
    const p1Results = results.filter(r => r.productId === 'p1' && r.matchedVia === 'products')
    expect(p1Results).toHaveLength(1)
    expect(p1Results[0].similarity).toBe(0.9)
  })

  it('stops when limit is reached', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'products'"))
        return {
          rows: [
            { source_id: 'p1', similarity: 0.9 },
            { source_id: 'p2', similarity: 0.8 },
            { source_id: 'p3', similarity: 0.7 },
          ],
        }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test', 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('sorts mixed products and variants by similarity descending', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes("source_table = 'products'")) return { rows: [{ source_id: 'p1', similarity: 0.7 }] }
      if (sql.includes("source_table = 'product_variants'")) return { rows: [{ source_id: 'var-1', similarity: 0.9 }] }
      return { rows: [] }
    })
    const results = await findSimilarProductIds('test')
    expect(results[0].similarity).toBe(0.9)
    expect(results[1].similarity).toBe(0.7)
  })
})

// ── Tests: findSimilarCustomers ───────────────────────────────────────────────

describe('findSimilarCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  it('delegates to findSimilar with users table', async () => {
    const results = await findSimilarCustomers('john')
    expect(results).toEqual([])
  })
})

// #489: the shared replica holds ONLY platform data. A tenant request must never read it — every
// query filters tenant_id (platform = NULL), and the raw escape hatch refuses on a tenant.
describe('tenant isolation (#489)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([MOCK_VEC])
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  it('findSimilar off-tenant filters tenant_id IS NULL (platform rows)', async () => {
    mockResolveTenantId.mockResolvedValue(null)
    await findSimilar('q')
    const [sql, params] = mockClientQuery.mock.calls.at(-1)!
    expect(sql).toMatch(/tenant_id IS NOT DISTINCT FROM/)
    expect(params).toContain(null)
  })

  it('findSimilar on a tenant filters by that tenant id', async () => {
    mockResolveTenantId.mockResolvedValue('t-123')
    await findSimilar('q')
    const [sql, params] = mockClientQuery.mock.calls.at(-1)!
    expect(sql).toMatch(/tenant_id IS NOT DISTINCT FROM/)
    expect(params).toContain('t-123')
  })

  it('findSimilarProductIds scopes the product + variant queries to the tenant', async () => {
    mockResolveTenantId.mockResolvedValue('t-123')
    await findSimilarProductIds('bolt')
    const tenantScoped = mockClientQuery.mock.calls.filter(
      c => /tenant_id IS NOT DISTINCT FROM/.test(c[0]) && (c[1] as unknown[]).includes('t-123')
    )
    expect(tenantScoped.length).toBeGreaterThanOrEqual(2) // products + product_variants
  })

  it('queryManyReplica refuses on a tenant (returns [] without touching the pool)', async () => {
    mockResolveTenantId.mockResolvedValue('t-123')
    const rows = await queryManyReplica('SELECT 1')
    expect(rows).toEqual([])
    expect(mockPoolConnect).not.toHaveBeenCalled()
  })

  it('queryManyReplica runs off-tenant (platform)', async () => {
    mockResolveTenantId.mockResolvedValue(null)
    mockClientQuery.mockResolvedValue({ rows: [{ x: 1 }] })
    const rows = await queryManyReplica('SELECT 1')
    expect(rows).toEqual([{ x: 1 }])
    expect(mockPoolConnect).toHaveBeenCalled()
  })
})
