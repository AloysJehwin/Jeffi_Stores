import { describe, it, expect } from 'vitest'
import { prefixTsQuery, buildVectorSearchClause, buildSearchClause } from '../src/search'

describe('prefixTsQuery', () => {
  it('strips non-word chars and suffixes :* per word, &-joined', () => {
    expect(prefixTsQuery('bolt m8')).toBe('bolt:* & m8:*')
  })
  it('drops words that reduce to empty', () => {
    expect(prefixTsQuery('a-- !! b')).toBe('a:* & b:*')
  })
  it('empty for whitespace-only', () => {
    expect(prefixTsQuery('   ')).toBe('')
  })
})

describe('buildVectorSearchClause', () => {
  it('empty query → TRUE, no params, idx unchanged', () => {
    expect(buildVectorSearchClause('   ', 'v', ['c'], ['e'], 3)).toEqual({ clause: 'TRUE', params: [], nextIdx: 3 })
  })

  it('builds fts + trgm + exact parts with correct placeholders and params', () => {
    const r = buildVectorSearchClause('hello', 'o.vec', ['o.name'], ['o.num'], 1, 'simple')
    expect(r.clause).toBe(
      "(o.vec @@ to_tsquery('simple', $1) OR similarity(o.name, $2::text) > 0.12 OR o.num ILIKE $3)"
    )
    expect(r.params).toEqual(['hello:*', 'hello', '%hello%'])
    expect(r.nextIdx).toBe(4)
  })

  it('default ftsConfig is simple', () => {
    const r = buildVectorSearchClause('x', 'v', [], [], 1)
    expect(r.clause).toContain("to_tsquery('simple', $1)")
  })

  it('english config', () => {
    const r = buildVectorSearchClause('x', 'v', [], [], 1, 'english')
    expect(r.clause).toContain("to_tsquery('english', $1)")
  })

  it('no tsquery part when query has no word chars (only trgm/exact)', () => {
    const r = buildVectorSearchClause('---', 'v', ['c'], [], 1)
    // prefixTsQuery empty, so first param is the trgm one
    expect(r.clause).toBe('(similarity(c, $1::text) > 0.12)')
    expect(r.params).toEqual(['---'])
    expect(r.nextIdx).toBe(2)
  })

  it('escapes LIKE wildcards in the exact param', () => {
    const r = buildVectorSearchClause('a%b', 'v', [], ['e'], 1)
    expect(r.params).toContain('%a\\%b%')
  })

  it('TRUE when nothing word-like and no columns at all', () => {
    const r = buildVectorSearchClause('---', 'v', [], [], 1)
    expect(r.clause).toBe('TRUE')
    expect(r.nextIdx).toBe(1)
  })
})

describe('buildSearchClause', () => {
  it('empty → TRUE at startIdx (default 1)', () => {
    expect(buildSearchClause('  ')).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('single word, single column: ILIKE AND word_similarity', () => {
    const r = buildSearchClause('foo', ['c'], 1)
    expect(r.clause).toBe("((c ILIKE $1) OR word_similarity($2::text, COALESCE(c,'')) > 0.5)")
    expect(r.params).toEqual(['%foo%', 'foo'])
    expect(r.nextIdx).toBe(3)
  })

  it('multi word, multi column: AND within a column, trgm per word×col', () => {
    const r = buildSearchClause('a b', ['c1', 'c2'], 1)
    expect(r.clause).toBe(
      "((c1 ILIKE $1 AND c1 ILIKE $2) OR (c2 ILIKE $3 AND c2 ILIKE $4) OR " +
        "word_similarity($5::text, COALESCE(c1,'')) > 0.5 OR word_similarity($5::text, COALESCE(c2,'')) > 0.5 OR " +
        "word_similarity($6::text, COALESCE(c1,'')) > 0.5 OR word_similarity($6::text, COALESCE(c2,'')) > 0.5)"
    )
    expect(r.params).toEqual(['%a%', '%b%', '%a%', '%b%', 'a', 'b'])
    expect(r.nextIdx).toBe(7)
  })

  it('trims leading/trailing punctuation off words', () => {
    const r = buildSearchClause('(foo)', ['c'], 1)
    expect(r.params[0]).toBe('%foo%')
  })

  it('respects a non-default startIdx', () => {
    const r = buildSearchClause('x', ['c'], 10)
    expect(r.clause).toContain('$10')
    expect(r.nextIdx).toBe(12)
  })
})
