import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/list-filters', () => ({
  prefixTsQuery: vi.fn(),
  buildSearchClause: vi.fn(),
  buildVectorSearchClause: vi.fn(),
}))

import { buildProductSearchClause } from '../src/lib/search.js'
import { prefixTsQuery } from '@jeffi/list-filters'

describe('buildProductSearchClause', () => {
  beforeEach(() => {
    vi.mocked(prefixTsQuery).mockReset()
  })

  it('returns TRUE for empty/whitespace raw without calling tsQuery', () => {
    const r = buildProductSearchClause('   ', 'name', 'sku', 'vec', 5)
    expect(r).toEqual({ clause: 'TRUE', params: [], nextIdx: 5 })
    expect(prefixTsQuery).not.toHaveBeenCalled()
  })

  it('returns TRUE when tsQuery yields null', () => {
    vi.mocked(prefixTsQuery).mockReturnValue(null as any)
    const r = buildProductSearchClause('!!!', 'name', 'sku', 'vec', 3)
    expect(r).toEqual({ clause: 'TRUE', params: [], nextIdx: 3 })
  })

  it('builds full-text + fuzzy + sku + per-word clause with advancing params', () => {
    vi.mocked(prefixTsQuery).mockReturnValue('widget:*' as any)
    const r = buildProductSearchClause('widget gadget', 'n', 's', 'v', 1)
    // 4 fixed parts (ts, similarity, sku) + 2 words = params: tsq, q, q%, w1, w2
    expect(r.params).toEqual(['widget:*', 'widget gadget', 'widget gadget%', 'widget', 'gadget'])
    expect(r.nextIdx).toBe(6)
    expect(r.clause).toBe(
      "(v @@ to_tsquery('english', $1) OR similarity(n, $2::text) > 0.12 OR s ILIKE $3 OR word_similarity($4::text, n) > 0.5 OR word_similarity($5::text, n) > 0.5)"
    )
  })

  it('strips leading/trailing punctuation from search words', () => {
    vi.mocked(prefixTsQuery).mockReturnValue('q:*' as any)
    const r = buildProductSearchClause('(bolt!) #nut', 'n', 's', 'v', 1)
    // words after stripping punctuation: bolt, nut (word params are the last two)
    expect(r.params.slice(-2)).toEqual(['bolt', 'nut'])
  })

  it('honors a non-1 startIdx', () => {
    vi.mocked(prefixTsQuery).mockReturnValue('q:*' as any)
    const r = buildProductSearchClause('bolt', 'n', 's', 'v', 10)
    expect(r.params).toEqual(['q:*', 'bolt', 'bolt%', 'bolt'])
    expect(r.nextIdx).toBe(14)
    expect(r.clause).toContain('$10')
    expect(r.clause).toContain('$13')
  })
})
