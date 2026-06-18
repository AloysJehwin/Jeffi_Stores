import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/rag', () => ({ findSimilarProductIds: vi.fn() }))
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: '0' }))

import { getRemainingQuota, searchCandidates, searchCandidatesViaRag, recommendProducts } from '@/lib/ai-assistant'
import * as db from '@/lib/db'
import * as aiClient from '@/lib/ai-client'
import * as rag from '@/lib/rag'

const mockQuery = db.query as ReturnType<typeof vi.fn>
const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>
const mockAiChat = aiClient.aiChat as ReturnType<typeof vi.fn>
const mockFindSimilar = rag.findSimilarProductIds as ReturnType<typeof vi.fn>

function makeProduct(overrides = {}) {
  return {
    id: 'p1',
    name: 'Bolt M6',
    slug: 'bolt-m6',
    sku: 'BOLT-M6',
    base_price: '150',
    brand_name: 'Unbrako',
    category_name: 'Fasteners',
    short_description: 'Standard bolt',
    ai_description: 'Industrial bolt',
    ai_use_cases: ['fixing', 'assembly'],
    inventory_quantity: 100,
    primary_image_url: 'img.jpg',
    ...overrides,
  }
}

describe('getRemainingQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct used/remaining counts', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '3' })
    const result = await getRemainingQuota('user-1')
    expect(result.used).toBe(3)
    expect(result.remaining).toBe(7)
    expect(result.resetAt instanceof Date).toBe(true)
  })

  it('returns remaining=10 when used=0', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' })
    const result = await getRemainingQuota('user-1')
    expect(result.remaining).toBe(10)
  })

  it('clamps remaining to 0 when used >= limit', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '15' })
    const result = await getRemainingQuota('user-1')
    expect(result.remaining).toBe(0)
  })

  it('handles null row gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getRemainingQuota('user-1')
    expect(result.used).toBe(0)
    expect(result.remaining).toBe(10)
  })
})

describe('searchCandidatesViaRag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when findSimilarProductIds returns empty', async () => {
    mockFindSimilar.mockResolvedValueOnce([])
    const result = await searchCandidatesViaRag('bolts', 10)
    expect(result).toEqual([])
  })

  it('returns empty array when all ids are variantIds but no products found', async () => {
    mockFindSimilar.mockResolvedValueOnce([{ variantId: 'v1', productId: null }])
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'v1', product_id: 'p1' }]) // product_variants
      .mockResolvedValueOnce([]) // products

    const result = await searchCandidatesViaRag('bolts', 10)
    expect(result).toEqual([])
  })

  it('returns sorted products by original RAG order', async () => {
    mockFindSimilar.mockResolvedValueOnce([
      { productId: 'p2', variantId: null },
      { productId: 'p1', variantId: null },
    ])
    const p1 = makeProduct({ id: 'p1' })
    const p2 = makeProduct({ id: 'p2', name: 'Nut M6', slug: 'nut-m6', sku: 'NUT-M6' })
    mockQueryMany
      .mockResolvedValueOnce([p1, p2]) // products query

    const result = await searchCandidatesViaRag('bolts')
    expect(result[0].id).toBe('p2')
    expect(result[1].id).toBe('p1')
  })
})

describe('searchCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns FTS results when available', async () => {
    const products = [makeProduct()]
    mockQueryMany.mockResolvedValueOnce(products)
    const result = await searchCandidates('bolt', 10)
    expect(result).toHaveLength(1)
  })

  it('falls back to featured products when FTS returns empty', async () => {
    const featured = [makeProduct({ id: 'p2', is_featured: true })]
    mockQueryMany
      .mockResolvedValueOnce([]) // FTS returns empty
      .mockResolvedValueOnce(featured) // fallback

    const result = await searchCandidates('xyzxyz', 10)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p2')
  })
})

describe('recommendProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when daily limit is exceeded', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '10' }) // quota = 0 remaining
    await expect(recommendProducts('user-1', 'bolts')).rejects.toThrow('Daily limit reached')
  })

  it('returns no-results response when no candidates found', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' }) // quota ok
    mockFindSimilar.mockResolvedValueOnce([]) // RAG empty
    mockQueryMany.mockResolvedValue([]) // FTS empty
    mockQueryOne.mockResolvedValueOnce({ id: 'q1' }) // ai_queries insert

    const result = await recommendProducts('user-1', 'xyzxyz')
    expect(result.recommendations).toHaveLength(0)
    expect(result.source).toBe('none')
    expect(result.summary).toContain("couldn't find")
  })

  it('returns keyword source when RAG empty but FTS finds results', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' }) // quota
    mockFindSimilar.mockResolvedValueOnce([]) // RAG empty
    mockQueryMany.mockResolvedValueOnce([makeProduct()]) // FTS results

    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Found bolts',
        recommendations: [{ product_id: 'p1', quantity: 5, reason: 'Good bolt' }],
      }),
      provider: 'openai', model: 'gpt-4o-mini', latencyMs: 50, fallbackUsed: false,
    })
    mockQueryOne.mockResolvedValueOnce({ id: 'q1' }) // insert

    const result = await recommendProducts('user-1', 'bolt')
    expect(result.source).toBe('keyword')
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].quantity).toBe(5)
  })

  it('uses rag source when RAG returns products', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '2' }) // quota
    mockFindSimilar.mockResolvedValueOnce([{ productId: 'p1', variantId: null }])
    mockQueryMany.mockResolvedValueOnce([makeProduct()]) // RAG products

    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'RAG results',
        recommendations: [{ product_id: 'p1', quantity: 2, reason: 'Exact match' }],
      }),
      provider: 'openai', model: 'gpt-4o-mini', latencyMs: 30, fallbackUsed: false,
    })
    mockQueryOne.mockResolvedValueOnce({ id: 'q2' }) // insert

    const result = await recommendProducts('user-1', 'bolt M6')
    expect(result.source).toBe('rag')
  })

  it('filters out unknown product_ids from AI recommendations', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' })
    mockFindSimilar.mockResolvedValueOnce([])
    mockQueryMany.mockResolvedValueOnce([makeProduct({ id: 'p1' })])

    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'Results',
        recommendations: [
          { product_id: 'p1', quantity: 1, reason: 'known' },
          { product_id: 'unknown-id', quantity: 1, reason: 'not in catalog' },
        ],
      }),
      provider: 'openai', model: 'gpt-4o-mini', latencyMs: 50, fallbackUsed: false,
    })
    mockQueryOne.mockResolvedValueOnce({ id: 'q3' })

    const result = await recommendProducts('user-1', 'test')
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].product.id).toBe('p1')
  })

  it('clamps quantity between 1 and 10000', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' })
    mockFindSimilar.mockResolvedValueOnce([])
    mockQueryMany.mockResolvedValueOnce([makeProduct()])

    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: 'ok',
        recommendations: [
          { product_id: 'p1', quantity: -5, reason: 'negative qty' },
        ],
      }),
      provider: 'openai', model: 'gpt-4o-mini', latencyMs: 50, fallbackUsed: false,
    })
    mockQueryOne.mockResolvedValueOnce({ id: 'q4' })

    const result = await recommendProducts('user-1', 'test')
    expect(result.recommendations[0].quantity).toBe(1)
  })

  it('inserts error row and throws when AI service fails', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' })
    mockFindSimilar.mockResolvedValueOnce([])
    mockQueryMany.mockResolvedValueOnce([makeProduct()])

    mockAiChat.mockRejectedValueOnce(new Error('AI down'))
    mockQuery.mockResolvedValue({ rows: [] })

    await expect(recommendProducts('user-1', 'test')).rejects.toThrow('AI service unavailable')
    expect(mockQuery).toHaveBeenCalled()
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('INSERT INTO ai_queries')
  })

  it('returns null aiQueryId when insert fails', async () => {
    mockQueryOne.mockResolvedValueOnce({ used: '0' })
    mockFindSimilar.mockResolvedValueOnce([])
    mockQueryMany.mockResolvedValueOnce([]) // no products

    mockQueryOne.mockResolvedValueOnce(null) // insert fails → null

    const result = await recommendProducts('user-1', 'noresult')
    expect(result.aiQueryId).toBeNull()
  })
})
