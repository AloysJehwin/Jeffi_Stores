import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ────────────────────────────────────────────────────────
const { mockQueryMany, mockFindSimilarProductIds, mockAiChat, AiClientError } = vi.hoisted(() => {
  // AiClientError must be a real class so `instanceof` checks behave correctly.
  class AiClientError extends Error {
    provider: string
    constructor(message: string, provider: string) {
      super(message)
      this.name = 'AiClientError'
      this.provider = provider
    }
  }
  return {
    mockQueryMany: vi.fn(),
    mockFindSimilarProductIds: vi.fn(),
    mockAiChat: vi.fn(),
    AiClientError,
  }
})

vi.mock('@/lib/db', () => ({
  queryMany: mockQueryMany,
}))

vi.mock('@/lib/rag', () => ({
  findSimilarProductIds: mockFindSimilarProductIds,
}))

vi.mock('@/lib/ai-client', () => ({
  aiChat: mockAiChat,
  AiClientError,
}))

vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: 'VMIN_PRICE',
  VARIANT_MIN_MRP_SQL: 'VMIN_MRP',
  VARIANT_STOCK_TOTAL_SQL: 'VSTOCK',
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import {
  aggregateUserSignals,
  getCandidates,
  getFeaturedForUser,
  getBestSellerCards,
} from '@/lib/recommendations'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a hydrate card row. hydrate() runs the CARD_SELECT query (contains 'FROM products p ... WHERE p.is_active').
function card(id: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    has_variants: false,
    base_price: 100,
    mrp: 120,
    variant_min_price: null,
    variant_min_mrp: null,
    variant_stock_total: null,
    stock_status: 'in_stock',
    discount_pct: null,
    extra_delivery_days: null,
    handling_days: null,
    product_images: [],
    brands: { name: 'BrandX' },
    categories: { name: 'CatX' },
    ...extra,
  }
}

// Classify a SQL string to decide which mock rows to return.
function sqlKind(sql: string): string {
  if (sql.includes('WITH signals AS')) return 'signals'
  if (sql.includes('SELECT DISTINCT oi.product_id')) return 'owned'
  if (sql.includes('FROM product_variants WHERE id = ANY')) return 'variantLookup'
  if (sql.includes('p.category_id = ANY') && sql.includes('p.brand_id = ANY')) return 'heuristic'
  if (sql.includes('total_sold') && sql.includes('p.id <> ALL')) return 'bestsellers'
  if (sql.includes('p.is_active = true AND p.id = ANY')) return 'hydrate'
  return 'unknown'
}

const UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── aggregateUserSignals ──────────────────────────────────────────────────────

describe('aggregateUserSignals', () => {
  it('aggregates seed names, exclude ids and top category/brand ids (deduped)', async () => {
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'signals') {
        return [
          { product_id: 'p1', name: 'Alpha', category_id: 'c1', brand_id: 'b1', score: 9 },
          { product_id: 'p2', name: 'Beta', category_id: 'c1', brand_id: 'b2', score: 8 }, // dup category
          { product_id: 'p3', name: '', category_id: null, brand_id: null, score: 7 }, // empty name filtered, null cat/brand filtered
        ]
      }
      if (kind === 'owned') {
        return [{ product_id: 'p1' }, { product_id: 'p9' }]
      }
      return []
    })

    const s = await aggregateUserSignals(UUID)
    expect(s.seedNames).toEqual(['Alpha', 'Beta']) // '' filtered out
    expect(s.excludeIds).toEqual(['p1', 'p9'])
    expect(s.topCategoryIds).toEqual(['c1']) // deduped
    expect(s.topBrandIds).toEqual(['b1', 'b2'])
  })

  it('returns empty signal arrays when the user has no history', async () => {
    mockQueryMany.mockResolvedValue([])
    const s = await aggregateUserSignals(UUID)
    expect(s.seedNames).toEqual([])
    expect(s.excludeIds).toEqual([])
    expect(s.topCategoryIds).toEqual([])
    expect(s.topBrandIds).toEqual([])
  })
})

// ── getCandidates ─────────────────────────────────────────────────────────────

describe('getCandidates', () => {
  const baseSignals = {
    seedNames: ['bolt', 'nut'],
    excludeIds: ['ex1'],
    topCategoryIds: ['c1'],
    topBrandIds: ['b1'],
  }

  it('Tier 1 vector: returns product matches when >=4 direct product ids', async () => {
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
      { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.7 },
      { matchedVia: 'products', productId: 'p4', variantId: null, similarity: 0.6 },
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.5 }, // dup skipped
      { matchedVia: 'products', productId: 'ex1', variantId: null, similarity: 0.4 }, // excluded
    ])
    const res = await getCandidates(baseSignals)
    expect(res.source).toBe('vector')
    expect(res.ids).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(res.seedQuery).toBe('bolt nut')
  })

  it('Tier 1 vector: resolves variant matches to product ids', async () => {
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
      { matchedVia: 'products', productId: 'p0', variantId: null, similarity: 0.85 },
      { matchedVia: 'product_variants', productId: '', variantId: 'v1', similarity: 0.8 },
      { matchedVia: 'product_variants', productId: '', variantId: 'v2', similarity: 0.7 },
    ])
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'variantLookup') {
        return [
          { product_id: 'p2' },
          { product_id: 'p3' },
          { product_id: 'ex1' }, // excluded via excl set
          { product_id: 'p2' }, // dup skipped
        ]
      }
      return []
    })
    const res = await getCandidates(baseSignals)
    expect(res.source).toBe('vector')
    expect(res.ids).toEqual(['p1', 'p0', 'p2', 'p3'])
  })

  it('Tier 1 falls through to heuristic when fewer than 4 vector ids', async () => {
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
    ])
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'heuristic') {
        return [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }]
      }
      return []
    })
    const res = await getCandidates(baseSignals)
    expect(res.source).toBe('heuristic')
    expect(res.ids).toEqual(['h1', 'h2', 'h3', 'h4'])
  })

  it('Tier 1 falls through to heuristic when RAG throws', async () => {
    mockFindSimilarProductIds.mockRejectedValue(new Error('rag down'))
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'heuristic') {
        return [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }]
      }
      return []
    })
    const res = await getCandidates(baseSignals)
    expect(res.source).toBe('heuristic')
  })

  it('falls through to best sellers when heuristic yields fewer than 4', async () => {
    mockFindSimilarProductIds.mockResolvedValue([])
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'heuristic') return [{ id: 'h1' }] // <4
      if (kind === 'bestsellers') return [{ id: 'bs1' }, { id: 'bs2' }]
      return []
    })
    const res = await getCandidates(baseSignals)
    expect(res.source).toBe('bestsellers')
    expect(res.ids).toEqual(['bs1', 'bs2'])
  })

  it('skips vector tier entirely with empty seedQuery and no top cats/brands -> best sellers with default exclude sentinel', async () => {
    const emptySignals = { seedNames: [], excludeIds: [], topCategoryIds: [], topBrandIds: [] }
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'bestsellers') return [{ id: 'bs1' }]
      return []
    })
    const res = await getCandidates(emptySignals)
    expect(res.source).toBe('bestsellers')
    expect(res.seedQuery).toBe('')
    // findSimilarProductIds must not be called when seedQuery is empty
    expect(mockFindSimilarProductIds).not.toHaveBeenCalled()
    // best seller query got the sentinel uuid because excludeIds is empty
    const bsCall = mockQueryMany.mock.calls.find(c => sqlKind(c[0]) === 'bestsellers')
    expect(bsCall?.[1]?.[0]).toEqual(['00000000-0000-0000-0000-000000000000'])
  })

  it('vector tier with only variant matches and no direct product matches falls through', async () => {
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'other', productId: '', variantId: '', similarity: 0.5 }, // neither branch
    ])
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'bestsellers') return [{ id: 'bs1' }]
      return []
    })
    const res = await getCandidates({ ...baseSignals, topCategoryIds: [], topBrandIds: [] })
    expect(res.source).toBe('bestsellers')
  })
})

// ── getBestSellerCards ────────────────────────────────────────────────────────

describe('getBestSellerCards', () => {
  it('returns hydrated cards in best-seller id order', async () => {
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'bestsellers') return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
      if (kind === 'hydrate') return [card('c'), card('a'), card('b')] // out of order
      return []
    })
    const cards = await getBestSellerCards(3)
    expect(cards.map(c => c.id)).toEqual(['a', 'b', 'c']) // re-sorted to id order
  })

  it('returns [] when there are no best sellers (hydrate short-circuits empty ids)', async () => {
    mockQueryMany.mockImplementation(async (sql: string) => {
      if (sqlKind(sql) === 'bestsellers') return []
      return []
    })
    const cards = await getBestSellerCards()
    expect(cards).toEqual([])
  })
})

// ── getFeaturedForUser ────────────────────────────────────────────────────────

describe('getFeaturedForUser', () => {
  it('best-sellers path: no curation, products sliced to want', async () => {
    const uid = 'user-bs-' + Math.random()
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'signals') return []
      if (kind === 'owned') return []
      if (kind === 'bestsellers') return [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }]
      if (kind === 'hydrate') return [card('b1'), card('b2'), card('b3')]
      return []
    })
    const res = await getFeaturedForUser(uid, 2)
    expect(res.source).toBe('bestsellers')
    expect(res.curated).toBe(false)
    expect(res.products.map(p => p.id)).toEqual(['b1', 'b2'])
    expect(res.candidateCount).toBe(3)
    expect(mockAiChat).not.toHaveBeenCalled()
    expect(typeof res.responseMs).toBe('number')
  })

  it('returns cached result on the second call for the same user', async () => {
    const uid = 'user-cache-' + Math.random()
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'bestsellers') return [{ id: 'b1' }]
      if (kind === 'hydrate') return [card('b1')]
      return []
    })
    const first = await getFeaturedForUser(uid, 4)
    const callsAfterFirst = mockQueryMany.mock.calls.length
    const second = await getFeaturedForUser(uid, 4)
    expect(second).toBe(first) // same cached object reference
    expect(mockQueryMany.mock.calls.length).toBe(callsAfterFirst) // no new queries
  })

  it('curates vector results via LLM and maps 1-based picks to ids', async () => {
    const uid = 'user-curate-' + Math.random()
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
      { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.7 },
      { matchedVia: 'products', productId: 'p4', variantId: null, similarity: 0.6 },
      { matchedVia: 'products', productId: 'p5', variantId: null, similarity: 0.5 },
    ])
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'signals') return [{ product_id: 'p1', name: 'Bolt', category_id: 'c1', brand_id: 'b1', score: 5 }]
      if (kind === 'owned') return []
      if (kind === 'hydrate') {
        return [
          card('p1', { has_variants: true, variant_min_price: 55 }),
          card('p2'),
          card('p3'),
          card('p4'),
          card('p5'),
        ]
      }
      return []
    })
    // model picks index 3 then 1 (1-based) -> p3, p1
    mockAiChat.mockResolvedValue({ content: '{"picks":[3,1]}', model: 'gemma3:4b', latencyMs: 42 })

    const res = await getFeaturedForUser(uid, 2)
    expect(res.source).toBe('vector')
    expect(res.curated).toBe(true)
    expect(res.model).toBe('gemma3:4b')
    expect(res.responseMs).toBe(42)
    expect(res.products.map(p => p.id)).toEqual(['p3', 'p1'])
    // price for p1 should come from variant_min_price since has_variants
    const chatArgs = mockAiChat.mock.calls[0][0]
    expect(chatArgs.messages[1].content).toContain('₹55')
  })
})

// ── curate branch coverage (through getFeaturedForUser) ───────────────────────

describe('curate branches (via getFeaturedForUser)', () => {
  function vectorFive() {
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
      { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.7 },
      { matchedVia: 'products', productId: 'p4', variantId: null, similarity: 0.6 },
      { matchedVia: 'products', productId: 'p5', variantId: null, similarity: 0.5 },
    ])
  }
  function stdQueryMany() {
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'signals') return [{ product_id: 'p1', name: 'Bolt', category_id: 'c1', brand_id: 'b1', score: 5 }]
      if (kind === 'owned') return []
      if (kind === 'hydrate') return [card('p1'), card('p2'), card('p3'), card('p4'), card('p5')]
      return []
    })
  }

  it('candidates.length <= want: returns fallback uncurated without calling LLM', async () => {
    const uid = 'u-few-' + Math.random()
    mockFindSimilarProductIds.mockResolvedValue([
      { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
      { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.7 },
      { matchedVia: 'products', productId: 'p4', variantId: null, similarity: 0.6 },
    ])
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      if (kind === 'signals') return [{ product_id: 'p1', name: 'Bolt', category_id: 'c1', brand_id: 'b1', score: 5 }]
      if (kind === 'owned') return []
      if (kind === 'hydrate') return [card('p1'), card('p2'), card('p3'), card('p4')]
      return []
    })
    const res = await getFeaturedForUser(uid, 8) // want(8) >= 4 candidates
    expect(res.source).toBe('vector')
    expect(res.curated).toBe(false)
    expect(mockAiChat).not.toHaveBeenCalled()
    expect(res.products.map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('parses JSON wrapped in markdown fences', async () => {
    const uid = 'u-fence-' + Math.random()
    vectorFive()
    stdQueryMany()
    mockAiChat.mockResolvedValue({ content: '```json\n{"picks":[2]}\n```', model: 'm', latencyMs: 1 })
    const res = await getFeaturedForUser(uid, 2)
    expect(res.curated).toBe(true)
    // p2 picked first, then topped up from candidate order (p1)
    expect(res.products.map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('unparseable content with no JSON object -> empty picks topped up from candidate order', async () => {
    const uid = 'u-bad-' + Math.random()
    vectorFive()
    stdQueryMany()
    mockAiChat.mockResolvedValue({ content: 'no json here', model: 'm', latencyMs: 3 })
    const res = await getFeaturedForUser(uid, 2)
    // parsed.picks empty -> picks topped up from candidate order (p1, p2)
    // so it is still curated:true with model metadata carried through
    expect(res.curated).toBe(true)
    expect(res.model).toBe('m')
    expect(res.responseMs).toBe(3)
    expect(res.products.map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('picks accept string numbers and drop out-of-range/duplicate values', async () => {
    const uid = 'u-str-' + Math.random()
    vectorFive()
    stdQueryMany()
    // "2" valid, 99 out of range, 2 duplicate, "abc" -> NaN
    mockAiChat.mockResolvedValue({ content: '{"picks":["2",99,2,"abc",4]}', model: 'm', latencyMs: 5 })
    const res = await getFeaturedForUser(uid, 3)
    expect(res.curated).toBe(true)
    // valid picks: index2->p2, index4->p4 ; top up with p1
    expect(res.products.map(p => p.id)).toEqual(['p2', 'p4', 'p1'])
  })

  it('aiChat throwing AiClientError degrades to fallback uncurated', async () => {
    const uid = 'u-err-' + Math.random()
    vectorFive()
    stdQueryMany()
    mockAiChat.mockRejectedValue(new AiClientError('llm down', 'ollama'))
    const res = await getFeaturedForUser(uid, 3)
    expect(res.curated).toBe(false)
    expect(res.products.map(p => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('aiChat throwing a non-AiClientError also degrades to fallback', async () => {
    const uid = 'u-err2-' + Math.random()
    vectorFive()
    stdQueryMany()
    mockAiChat.mockRejectedValue(new Error('boom'))
    const res = await getFeaturedForUser(uid, 3)
    expect(res.curated).toBe(false)
    expect(res.products.map(p => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('picks with no interest line when seedNames empty (heuristic source)', async () => {
    const uid = 'u-nointerest-' + Math.random()
    mockFindSimilarProductIds.mockResolvedValue([]) // no seed -> but seedNames empty means no vector call anyway
    mockQueryMany.mockImplementation(async (sql: string) => {
      const kind = sqlKind(sql)
      // signals return rows with categories/brands but empty names to keep seedQuery empty
      if (kind === 'signals') return [
        { product_id: 'p1', name: '', category_id: 'c1', brand_id: 'b1', score: 5 },
      ]
      if (kind === 'owned') return []
      if (kind === 'heuristic') return [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }]
      if (kind === 'hydrate') return [card('p1'), card('p2'), card('p3'), card('p4'), card('p5')]
      return []
    })
    mockAiChat.mockResolvedValue({ content: '{"picks":[1]}', model: 'm', latencyMs: 2 })
    const res = await getFeaturedForUser(uid, 2)
    expect(res.source).toBe('heuristic')
    expect(res.curated).toBe(true)
    const userContent = mockAiChat.mock.calls[0][0].messages[1].content
    // interest line omitted -> starts with two newlines before Candidates
    expect(userContent.startsWith('\n\nCandidates')).toBe(true)
  })
})
