import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/shared/rag', () => ({
  findSimilarProductIds: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/shared/ai-client', () => {
  class AiClientError extends Error {}
  return { aiChat: vi.fn(), AiClientError }
})

vi.mock('@/lib/shared/storefront-ai', () => ({
  storefrontAiAllowed: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: 'MIN_INCL',
  VARIANT_MIN_PRICE_EX_GST_SQL: 'MIN_EX',
  VARIANT_MIN_MRP_SQL: 'MIN_MRP',
  VARIANT_STOCK_TOTAL_SQL: 'STOCK_TOTAL',
}))

vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: false }),
}))

vi.mock('@/lib/catalog/pricing', () => ({
  pickUnitPrice: vi.fn(({ inclusive }: any, _g: boolean) => inclusive ?? 0),
}))

vi.mock('@/lib/catalog/public-product', () => ({
  publicProducts: vi.fn((rows: any[]) => rows),
}))

// Dynamically imported inside curate()
vi.mock('@/lib/catalog/brand', () => ({
  storeDescriptorForPrompt: vi.fn().mockResolvedValue('My Store'),
}))

import {
  aggregateUserSignals,
  getCandidates,
  getFeaturedForUser,
  getBestSellerCards,
} from '@/lib/catalog/recommendations'
import { queryMany } from '@/lib/shared/db'
import { findSimilarProductIds } from '@/lib/shared/rag'
import { aiChat } from '@/lib/shared/ai-client'
import { storefrontAiAllowed } from '@/lib/shared/storefront-ai'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

beforeEach(() => {
  vi.mocked(queryMany).mockReset().mockResolvedValue([] as any)
  vi.mocked(findSimilarProductIds).mockReset().mockResolvedValue([] as any)
  vi.mocked(aiChat).mockReset()
  vi.mocked(storefrontAiAllowed).mockReset().mockResolvedValue(false as any)
  vi.mocked(getFeatureFlags).mockReset().mockResolvedValue({ gstEnabled: false } as any)
})

// hydrate() rows: products with nested category/brand
function card(id: string, over: Partial<any> = {}) {
  return {
    id,
    name: `Prod ${id}`,
    has_variants: false,
    base_price: 100,
    price_ex_gst: 90,
    variant_min_price: null,
    categories: { name: 'Cat' },
    brands: { name: 'Brand' },
    ...over,
  }
}

describe('aggregateUserSignals', () => {
  it('runs the weighted-signal and owned queries and shapes the result', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        { product_id: 'p1', name: 'Bolt', category_id: 'c1', brand_id: 'b1', score: 9 },
        { product_id: 'p2', name: 'Nut', category_id: 'c1', brand_id: null, score: 5 },
      ] as any)
      .mockResolvedValueOnce([{ product_id: 'p1' }] as any)
    const s = await aggregateUserSignals('u1')
    expect(s.seedNames).toEqual(['Bolt', 'Nut'])
    expect(s.excludeIds).toEqual(['p1'])
    expect(s.topCategoryIds).toEqual(['c1']) // deduped
    expect(s.topBrandIds).toEqual(['b1']) // nulls dropped
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('WITH signals AS')
    expect(params).toEqual(['u1'])
  })
})

describe('getCandidates', () => {
  const emptySignals = { seedNames: [], excludeIds: [], topCategoryIds: [], topBrandIds: [] }

  it('falls back to best sellers with no signals', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'b1' }, { id: 'b2' }] as any)
    const r = await getCandidates(emptySignals, 10)
    expect(r.source).toBe('bestsellers')
    expect(r.ids).toEqual(['b1', 'b2'])
    // bestSellerIds substitutes a sentinel uuid when excludeIds empty
    expect((vi.mocked(queryMany).mock.calls[0][1] as any[])[0]).toEqual(['00000000-0000-0000-0000-000000000000'])
  })

  it('uses the vector tier when AI is allowed and ≥4 ids resolve', async () => {
    vi.mocked(storefrontAiAllowed).mockResolvedValue(true as any)
    vi.mocked(findSimilarProductIds).mockResolvedValue([
      { matchedVia: 'products', productId: 'p1' },
      { matchedVia: 'products', productId: 'p2' },
      { matchedVia: 'product_variants', variantId: 'v9' },
      { matchedVia: 'products', productId: 'p1' }, // dup ignored
    ] as any)
    // variant → product lookup yields p3, p4
    vi.mocked(queryMany).mockResolvedValueOnce([{ product_id: 'p3' }, { product_id: 'p4' }] as any)
    const r = await getCandidates({ ...emptySignals, seedNames: ['bolt'] }, 24)
    expect(r.source).toBe('vector')
    expect(r.ids).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(r.seedQuery).toBe('bolt')
  })

  it('drops excluded ids from the vector tier and falls through when <4 remain', async () => {
    vi.mocked(storefrontAiAllowed).mockResolvedValue(true as any)
    vi.mocked(findSimilarProductIds).mockResolvedValue([
      { matchedVia: 'products', productId: 'p1' },
    ] as any)
    // not enough from vector -> heuristic tier (has categories) -> queryMany for heuristic
    vi.mocked(queryMany).mockResolvedValue([{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }] as any)
    const r = await getCandidates(
      { ...emptySignals, seedNames: ['bolt'], excludeIds: ['p1'], topCategoryIds: ['c1'] },
      24
    )
    expect(r.source).toBe('heuristic')
    expect(r.ids).toEqual(['h1', 'h2', 'h3', 'h4'])
  })

  it('heuristic tier used when categories/brands present and ≥4 rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }] as any)
    const r = await getCandidates({ ...emptySignals, topBrandIds: ['b1'] }, 24)
    expect(r.source).toBe('heuristic')
    const params = vi.mocked(queryMany).mock.calls[0][1] as any[]
    expect(params[1]).toEqual(['b1']) // brand ids
    expect(params[0]).toEqual(['00000000-0000-0000-0000-000000000000']) // no categories sentinel
  })

  it('heuristic too thin → best sellers', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ id: 'h1' }] as any) // heuristic: only 1
      .mockResolvedValueOnce([{ id: 'b1' }] as any) // bestsellers
    const r = await getCandidates({ ...emptySignals, topCategoryIds: ['c1'] }, 24)
    expect(r.source).toBe('bestsellers')
  })
})

describe('getBestSellerCards', () => {
  it('hydrates, diversifies and orders the best-seller pool', async () => {
    // bestSellerIds query, then hydrate query
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as any)
      .mockResolvedValueOnce([card('p1'), card('p2')] as any)
    const out = await getBestSellerCards(8)
    expect(out.map(c => c.id)).toEqual(['p1', 'p2'])
  })

  it('caps near-identical family/brand+cat lines via diversify', async () => {
    // Two products with the SAME name family + brand/category collapse to one family (MAX_PER_FAMILY=1)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as any)
      .mockResolvedValueOnce([
        card('p1', { name: 'Hex Screw M6' }),
        card('p2', { name: 'Hex Screw M8' }), // same family as p1 -> deferred
        card('p3', { name: 'Washer Flat' }),
      ] as any)
    const out = await getBestSellerCards(2)
    // p1 kept, p2 deferred (same family), p3 kept -> [p1, p3]
    expect(out.map(c => c.id)).toEqual(['p1', 'p3'])
  })
})

describe('getFeaturedForUser', () => {
  it('best-sellers path: no curation, returns hydrated cards and caches', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as any) // aggregateUserSignals: scored
      .mockResolvedValueOnce([] as any) // aggregateUserSignals: owned
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as any) // bestSellerIds
      .mockResolvedValueOnce([card('p1'), card('p2')] as any) // hydrate
    const r = await getFeaturedForUser('user-A', 8)
    expect(r.source).toBe('bestsellers')
    expect(r.curated).toBe(false)
    expect(r.products.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(r.candidateCount).toBe(2)

    // second call is served from cache (no further queries)
    const callsBefore = vi.mocked(queryMany).mock.calls.length
    const r2 = await getFeaturedForUser('user-A', 8)
    expect(r2).toBe(r)
    expect(vi.mocked(queryMany).mock.calls.length).toBe(callsBefore)
  })

  it('curates personalised candidates when AI is allowed, honouring model picks', async () => {
    vi.mocked(storefrontAiAllowed).mockResolvedValue(true as any)
    // signals: strong -> heuristic tier
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        { product_id: 'p1', name: 'A', category_id: 'c1', brand_id: 'b1', score: 9 },
      ] as any) // scored
      .mockResolvedValueOnce([] as any) // owned
      .mockResolvedValueOnce([
        { id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }, { id: 'h5' },
      ] as any) // heuristic candidates (≥4)
      .mockResolvedValueOnce([
        card('h1', { categories: { name: 'C1' }, brands: { name: 'B1' } }),
        card('h2', { categories: { name: 'C2' }, brands: { name: 'B2' } }),
        card('h3', { categories: { name: 'C3' }, brands: { name: 'B3' } }),
        card('h4', { categories: { name: 'C4' }, brands: { name: 'B4' } }),
        card('h5', { categories: { name: 'C5' }, brands: { name: 'B5' } }),
      ] as any) // hydrate
    // curate asks the LLM; it returns picks by 1-based index
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify({ picks: [3, 1] }),
      model: 'gemma',
      latencyMs: 42,
    } as any)
    const r = await getFeaturedForUser('user-B', 2)
    expect(r.source).toBe('heuristic')
    expect(r.curated).toBe(true)
    expect(r.model).toBe('gemma')
    // picks [3,1] -> h3, h1; diversify keeps both (distinct families)
    expect(r.products.map(p => p.id)).toEqual(['h3', 'h1'])
  })

  it('degrades to the fallback order when the LLM call throws', async () => {
    vi.mocked(storefrontAiAllowed).mockResolvedValue(true as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        { product_id: 'p1', name: 'A', category_id: 'c1', brand_id: 'b1', score: 9 },
      ] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }, { id: 'h5' }] as any)
      .mockResolvedValueOnce([
        card('h1', { categories: { name: 'C1' }, brands: { name: 'B1' } }),
        card('h2', { categories: { name: 'C2' }, brands: { name: 'B2' } }),
        card('h3', { categories: { name: 'C3' }, brands: { name: 'B3' } }),
        card('h4', { categories: { name: 'C4' }, brands: { name: 'B4' } }),
        card('h5', { categories: { name: 'C5' }, brands: { name: 'B5' } }),
      ] as any)
    vi.mocked(aiChat).mockRejectedValue(new Error('ollama down'))
    const r = await getFeaturedForUser('user-C', 2)
    expect(r.curated).toBe(false)
    // fallback = first `want` candidates in original order
    expect(r.products.map(p => p.id)).toEqual(['h1', 'h2'])
  })
})
