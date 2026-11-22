import { describe, it, expect, vi } from 'vitest'

// tsQuery is prefixTsQuery from @jeffi/list-filters; the rest are re-exported untouched.
vi.mock('@jeffi/list-filters', () => ({
  prefixTsQuery: vi.fn((q: string) => (q.trim() ? `${q.trim().replace(/\s+/g, ':* & ')}:*` : '')),
  buildSearchClause: vi.fn(),
  buildVectorSearchClause: vi.fn(),
}))

import { buildProductSearchRank, buildSearchRank } from '../src/lib/search.js'

describe('buildProductSearchRank', () => {
  it('returns a zero rank with no params for an empty query', () => {
    const r = buildProductSearchRank('   ', 'name', 'search_vector', 5)
    expect(r).toEqual({ rank: '0', params: [], nextIdx: 5 })
  })

  it('builds the tiered rank and ordered params for a single word', () => {
    const r = buildProductSearchRank('lightning', 'p.name', 'p.sv', 1)
    // params order: stem q, per-word \m boundary, substring %q%, tsq, sim q
    expect(r.params).toEqual(['lightning', '\\mlightning', '%lightning%', 'lightning:*', 'lightning'])
    expect(r.nextIdx).toBe(6) // startIdx 1 + 5 params
    expect(r.rank).toContain("plainto_tsquery('english', $1)")
    expect(r.rank).toContain('p.name ~* $2')
    expect(r.rank).toContain('p.name ILIKE $3')
    expect(r.rank).toContain('ts_rank_cd(p.sv, to_tsquery')
    expect(r.rank).toContain('word_similarity($5::text, p.name)')
  })

  it('emits one word-boundary param per query word and advances nextIdx', () => {
    const r = buildProductSearchRank('red wire', 'name', 'sv', 10)
    // stem(10) + \mred(11) + \mwire(12) + substring(13) + tsq(14) + sim(15) → next 16
    expect(r.params).toEqual(['red wire', '\\mred', '\\mwire', '%red wire%', 'red:* & wire:*', 'red wire'])
    expect(r.nextIdx).toBe(16)
    expect(r.rank).toContain('LEAST(')
  })

  it("passes a safe tsq fallback when prefixTsQuery yields nothing", async () => {
    const lf = await import('@jeffi/list-filters')
    vi.mocked(lf.prefixTsQuery).mockReturnValueOnce('' as any)
    const r = buildProductSearchRank('stopword', 'name', 'sv', 1)
    // tsq empty → "''" fallback param supplied to to_tsquery
    expect(r.params).toContain("''")
  })
})

describe('buildSearchRank', () => {
  it('escapes single quotes and orders prefix over substring over miss', () => {
    const rank = buildSearchRank("o'brien", 'col')
    expect(rank).toContain("col ILIKE 'o''brien%'") // doubled quote
    expect(rank).toContain("col ILIKE '%o''brien%'")
    expect(rank).toContain("word_similarity('o''brien', COALESCE(col,'')))")
    expect(rank).toContain('THEN 0')
    expect(rank).toContain('ELSE 2')
  })

  it('trims the raw input', () => {
    const rank = buildSearchRank('  hi  ', 'c')
    expect(rank).toContain("c ILIKE 'hi%'")
  })
})
