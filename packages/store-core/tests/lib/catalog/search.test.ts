import { describe, it, expect } from 'vitest'
import {
  buildProductSearchClause,
  buildProductSearchRank,
  buildSearchRank,
} from '@/lib/catalog/search'

describe('buildProductSearchClause', () => {
  it('returns a TRUE no-op for blank input', () => {
    expect(buildProductSearchClause('   ', 'name', 'sku', 'vec', 3)).toEqual({
      clause: 'TRUE',
      params: [],
      nextIdx: 3,
    })
  })

  it('returns TRUE when nothing word-like survives tokenisation', () => {
    const r = buildProductSearchClause('!!! @@@', 'name', 'sku', 'vec', 1)
    expect(r.clause).toBe('TRUE')
    expect(r.params).toEqual([])
    expect(r.nextIdx).toBe(1)
  })

  it('builds fts + fuzzy + sku + per-word clauses with sequential placeholders', () => {
    const r = buildProductSearchClause('bolt m8', 'name', 'sku', 'vec', 1)
    // placeholders: $1 fts, $2 whole-query sim, $3 sku ilike, $4 word "bolt", $5 word "m8"
    expect(r.clause).toContain("vec @@ to_tsquery('english', $1)")
    expect(r.clause).toContain('similarity(name, $2::text) > 0.12')
    expect(r.clause).toContain('sku ILIKE $3')
    expect(r.clause).toContain('word_similarity($4::text, name) > 0.5')
    expect(r.clause).toContain('word_similarity($5::text, name) > 0.5')
    expect(r.clause.startsWith('(')).toBe(true)
    expect(r.params).toEqual(['bolt:* & m8:*', 'bolt m8', 'bolt m8%', 'bolt', 'm8'])
    expect(r.nextIdx).toBe(6)
  })

  it('honours a non-1 startIdx', () => {
    const r = buildProductSearchClause('bolt', 'n', 's', 'v', 5)
    expect(r.clause).toContain("v @@ to_tsquery('english', $5)")
    expect(r.nextIdx).toBe(9) // 5 fts, 6 sim, 7 sku, 8 word
  })
})

describe('buildProductSearchRank', () => {
  it('returns a zero rank for blank input', () => {
    expect(buildProductSearchRank('  ', 'name', 'vec', 1)).toEqual({ rank: '0', params: [], nextIdx: 1 })
  })

  it('assembles tiered rank with stem/word/substring/fts/sim params', () => {
    const r = buildProductSearchRank('bolt m8', 'name', 'vec', 1)
    // $1 stem q, $2 word bolt, $3 word m8, $4 substring, $5 tsq, $6 sim
    expect(r.params).toEqual(['bolt m8', '\\mbolt', '\\mm8', '%bolt m8%', 'bolt:* & m8:*', 'bolt m8'])
    expect(r.rank).toContain("plainto_tsquery('english', $1)")
    expect(r.rank).toContain('LEAST(')
    expect(r.rank).toContain('name ~* $2')
    expect(r.rank).toContain('name ~* $3')
    expect(r.rank).toContain('name ILIKE $4')
    expect(r.rank).toContain("to_tsquery('english', $5)")
    expect(r.rank).toContain('word_similarity($6::text, name)')
    expect(r.nextIdx).toBe(7)
  })

  it('uses the "1" word-tier and empty tsq fallback when there are no words', () => {
    // punctuation-only: searchWords() -> [], prefixTsQuery -> '' => "''"
    const r = buildProductSearchRank('!!!', 'name', 'vec', 1)
    expect(r.rank).toContain('+ 1')
    expect(r.rank).not.toContain('LEAST(')
    expect(r.params).toContain("''")
  })
})

describe('buildSearchRank', () => {
  it('escapes single quotes and builds the prefix/substring/fuzzy rank', () => {
    const rank = buildSearchRank("O'Brien", 'col')
    expect(rank).toContain("col ILIKE 'O''Brien%'")
    expect(rank).toContain("col ILIKE '%O''Brien%'")
    expect(rank).toContain("word_similarity('O''Brien', COALESCE(col,''))")
  })
})
