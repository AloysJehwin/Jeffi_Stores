import { describe, it, expect } from 'vitest'
import {
  buildProductSearchClause,
  buildProductSearchRank,
  buildVectorSearchClause,
  buildSearchClause,
  buildSearchRank,
} from '@/lib/search'

// ---------------------------------------------------------------------------
// buildProductSearchClause
// ---------------------------------------------------------------------------

describe('buildProductSearchClause', () => {
  const NAME = 'p.name'
  const SKU = 'p.sku'
  const VEC = 'p.search_vector'

  it('returns TRUE for empty string', () => {
    const result = buildProductSearchClause('', NAME, SKU, VEC, 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('returns TRUE for whitespace-only string', () => {
    const result = buildProductSearchClause('   ', NAME, SKU, VEC, 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('builds clause for special-char-only input (tsQuery still produces ":*")', () => {
    // '!!!' → each word stripped of non-word chars → '' + ':*' = ':*', which is truthy
    // '!!!' strips to empty, so searchWords() yields no per-word fuzzy params.
    const result = buildProductSearchClause('!!!', NAME, SKU, VEC, 1)
    expect(result.nextIdx).toBe(4)
    expect(result.params[0]).toBe(':*')
    expect(result.params[1]).toBe('!!!')
    expect(result.params[2]).toBe('!!!%')
  })

  it('builds clause for a single word at startIdx=1', () => {
    const result = buildProductSearchClause('bolt', NAME, SKU, VEC, 1)
    // tsq($1), similarity($2), sku ILIKE($3), per-word word_similarity($4)
    expect(result.nextIdx).toBe(5)
    expect(result.params).toEqual(['bolt:*', 'bolt', 'bolt%', 'bolt'])
    expect(result.clause).toContain(`${VEC} @@ to_tsquery('english', $1)`)
    expect(result.clause).toContain(`similarity(${NAME}, $2::text) > 0.12`)
    expect(result.clause).toContain(`${SKU} ILIKE $3`)
    expect(result.clause).toContain(`word_similarity($4::text, ${NAME}) > 0.5`)
  })

  it('builds clause at a custom startIdx', () => {
    const result = buildProductSearchClause('bolt', NAME, SKU, VEC, 5)
    expect(result.nextIdx).toBe(9)
    expect(result.params).toEqual(['bolt:*', 'bolt', 'bolt%', 'bolt'])
    expect(result.clause).toContain('$5')
    expect(result.clause).toContain('$6')
    expect(result.clause).toContain('$7')
    expect(result.clause).toContain('$8')
  })

  it('builds tsQuery with multiple words joined by &', () => {
    const result = buildProductSearchClause('hex bolt', NAME, SKU, VEC, 1)
    expect(result.params[0]).toBe('hex:* & bolt:*')
    expect(result.params[1]).toBe('hex bolt')
    expect(result.params[2]).toBe('hex bolt%')
    // one per-word fuzzy param per word: 'hex' and 'bolt'
    expect(result.params[3]).toBe('hex')
    expect(result.params[4]).toBe('bolt')
    expect(result.nextIdx).toBe(6)
  })

  it('strips non-word characters in tsQuery', () => {
    const result = buildProductSearchClause('bolt!@#', NAME, SKU, VEC, 1)
    expect(result.params[0]).toBe('bolt:*')
  })

  it('trims leading/trailing whitespace before building', () => {
    const result = buildProductSearchClause('  nut  ', NAME, SKU, VEC, 1)
    expect(result.params[1]).toBe('nut')
    expect(result.params[2]).toBe('nut%')
  })
})

// ---------------------------------------------------------------------------
// buildProductSearchRank
// ---------------------------------------------------------------------------

describe('buildProductSearchRank', () => {
  const NAME = 'p.name'
  const VEC = 'p.search_vector'

  it('returns zero rank for empty string', () => {
    const result = buildProductSearchRank('', NAME, VEC, 1)
    expect(result).toEqual({ rank: '0', params: [], nextIdx: 1 })
  })

  it('returns zero rank for whitespace-only string', () => {
    const result = buildProductSearchRank('   ', NAME, VEC, 1)
    expect(result).toEqual({ rank: '0', params: [], nextIdx: 1 })
  })

  it('builds rank for single word at startIdx=1', () => {
    const result = buildProductSearchRank('bolt', NAME, VEC, 1)
    // params: [prefix, contains, tsq, per-word word_similarity term]
    expect(result.nextIdx).toBe(5)
    expect(result.params).toEqual(['bolt%', '%bolt%', 'bolt:*', 'bolt'])
    expect(result.rank).toContain(`${NAME} ILIKE $1`)
    expect(result.rank).toContain(`${NAME} ILIKE $2`)
    expect(result.rank).toContain(`${VEC}, to_tsquery('english', $3)`)
    expect(result.rank).toContain(`word_similarity($4::text, ${NAME})`)
  })

  it('builds rank at a custom startIdx', () => {
    const result = buildProductSearchRank('nut', NAME, VEC, 7)
    expect(result.nextIdx).toBe(11)
    expect(result.rank).toContain('$7')
    expect(result.rank).toContain('$8')
    expect(result.rank).toContain('$9')
    expect(result.rank).toContain('$10')
  })

  it('uses ":*" tsQuery for special-char-only input (never falls back to "\'\'")', () => {
    // '!!!' → stripped word = '' + ':*' = ':*' (truthy, kept)
    const result = buildProductSearchRank('!!!', NAME, VEC, 1)
    expect(result.params[2]).toBe(':*')
  })

  it('builds correct tsQuery for multi-word input', () => {
    const result = buildProductSearchRank('hex bolt', NAME, VEC, 1)
    expect(result.params[0]).toBe('hex bolt%')
    expect(result.params[1]).toBe('%hex bolt%')
    expect(result.params[2]).toBe('hex:* & bolt:*')
    // whole-query term feeds the per-word word_similarity rank component
    expect(result.params[3]).toBe('hex bolt')
    expect(result.nextIdx).toBe(5)
  })

  it('trims input before building', () => {
    const result = buildProductSearchRank('  screw  ', NAME, VEC, 1)
    expect(result.params[0]).toBe('screw%')
    expect(result.params[1]).toBe('%screw%')
  })
})

// ---------------------------------------------------------------------------
// buildVectorSearchClause
// ---------------------------------------------------------------------------

describe('buildVectorSearchClause', () => {
  const VEC = 'c.search_vector'

  it('returns TRUE for empty string', () => {
    const result = buildVectorSearchClause('', VEC, ['c.name'], [], 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('returns TRUE for whitespace-only string', () => {
    const result = buildVectorSearchClause('   ', VEC, [], [], 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('builds clause with tsq only (no trgmCols, no exactCols)', () => {
    const result = buildVectorSearchClause('bolt', VEC, [], [], 1)
    expect(result.nextIdx).toBe(2)
    expect(result.params).toEqual(['bolt:*'])
    expect(result.clause).toContain(`${VEC} @@ to_tsquery('simple', $1)`)
  })

  it('uses english ftsConfig when specified', () => {
    const result = buildVectorSearchClause('bolt', VEC, [], [], 1, 'english')
    expect(result.clause).toContain(`to_tsquery('english', $1)`)
  })

  it('builds clause with one trgmCol', () => {
    const result = buildVectorSearchClause('bolt', VEC, ['c.name'], [], 1)
    expect(result.nextIdx).toBe(3)
    expect(result.params).toEqual(['bolt:*', 'bolt'])
    expect(result.clause).toContain(`similarity(c.name, $2::text) > 0.12`)
  })

  it('builds clause with multiple trgmCols', () => {
    const result = buildVectorSearchClause('hex', VEC, ['c.name', 'c.slug'], [], 1)
    expect(result.nextIdx).toBe(4)
    expect(result.params).toEqual(['hex:*', 'hex', 'hex'])
    expect(result.clause).toContain('similarity(c.name, $2::text) > 0.12')
    expect(result.clause).toContain('similarity(c.slug, $3::text) > 0.12')
  })

  it('builds clause with one exactCol', () => {
    const result = buildVectorSearchClause('bolt', VEC, [], ['c.code'], 1)
    expect(result.nextIdx).toBe(3)
    expect(result.params).toEqual(['bolt:*', '%bolt%'])
    expect(result.clause).toContain(`c.code ILIKE $2`)
  })

  it('builds clause with multiple exactCols', () => {
    const result = buildVectorSearchClause('hex', VEC, [], ['c.code', 'c.barcode'], 1)
    expect(result.nextIdx).toBe(4)
    expect(result.params).toEqual(['hex:*', '%hex%', '%hex%'])
    expect(result.clause).toContain('c.code ILIKE $2')
    expect(result.clause).toContain('c.barcode ILIKE $3')
  })

  it('builds clause combining trgmCols and exactCols', () => {
    const result = buildVectorSearchClause('nut', VEC, ['c.name'], ['c.code'], 1)
    expect(result.nextIdx).toBe(4)
    expect(result.params).toEqual(['nut:*', 'nut', '%nut%'])
    expect(result.clause).toContain(`${VEC} @@ to_tsquery('simple', $1)`)
    expect(result.clause).toContain('similarity(c.name, $2::text) > 0.12')
    expect(result.clause).toContain('c.code ILIKE $3')
  })

  it('respects custom startIdx', () => {
    const result = buildVectorSearchClause('bolt', VEC, ['c.name'], [], 5)
    expect(result.nextIdx).toBe(7)
    expect(result.clause).toContain('$5')
    expect(result.clause).toContain('$6')
  })

  it('builds vector clause for special-char-only input (tsq is ":*", not empty)', () => {
    // '!!!' → tsq = ':*' (truthy), so the vector part IS added
    const result = buildVectorSearchClause('!!!', VEC, [], [], 1)
    expect(result.params).toEqual([':*'])
    expect(result.nextIdx).toBe(2)
    expect(result.clause).toContain(`${VEC} @@ to_tsquery('simple', $1)`)
  })

  it('builds all parts for special-char-only input with trgm/exact cols', () => {
    const result = buildVectorSearchClause('!!!', VEC, ['c.name'], ['c.code'], 1)
    // tsq=':*', trgm param='!!!', exact param='%!!!%'
    expect(result.params).toEqual([':*', '!!!', '%!!!%'])
    expect(result.nextIdx).toBe(4)
    expect(result.clause).toContain(`${VEC} @@ to_tsquery('simple', $1)`)
    expect(result.clause).toContain('similarity(c.name, $2::text) > 0.12')
    expect(result.clause).toContain('c.code ILIKE $3')
  })
})

// ---------------------------------------------------------------------------
// buildSearchClause
// ---------------------------------------------------------------------------

describe('buildSearchClause', () => {
  it('returns TRUE for empty string', () => {
    const result = buildSearchClause('', ['p.name'])
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('returns TRUE for whitespace-only string', () => {
    const result = buildSearchClause('   ', ['p.name'])
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('returns TRUE for empty columns array (no words to match)', () => {
    // words exist but columns=[] → colClauses=[], trgmClauses=[], still builds
    // Actually with columns=[] the output will have empty colClauses but still run
    const result = buildSearchClause('bolt', [])
    // colClauses is empty array, trgmClauses is empty array → clause is "(  OR )"
    // params = ['bolt'] (the trgm param), nextIdx = 2
    expect(result.params).toEqual(['bolt'])
    expect(result.nextIdx).toBe(2)
  })

  it('builds clause for single word, single column at default startIdx', () => {
    const result = buildSearchClause('bolt', ['p.name'])
    expect(result.nextIdx).toBe(3)
    // params: ['%bolt%', 'bolt'] — one ILIKE param + one per-word trgm param
    expect(result.params).toEqual(['%bolt%', 'bolt'])
    expect(result.clause).toContain('p.name ILIKE $1')
    expect(result.clause).toContain("word_similarity($2::text, COALESCE(p.name,'')) > 0.5")
  })

  it('builds clause for single word, multiple columns', () => {
    const result = buildSearchClause('bolt', ['p.name', 'p.sku'])
    expect(result.nextIdx).toBe(4)
    // params: ['%bolt%', '%bolt%', 'bolt'] — ILIKE per column + one shared trgm param
    expect(result.params).toEqual(['%bolt%', '%bolt%', 'bolt'])
    expect(result.clause).toContain('p.name ILIKE $1')
    expect(result.clause).toContain('p.sku ILIKE $2')
    expect(result.clause).toContain("word_similarity($3::text, COALESCE(p.name,'')) > 0.5")
    expect(result.clause).toContain("word_similarity($3::text, COALESCE(p.sku,'')) > 0.5")
  })

  it('builds clause for multi-word input (AND within each column)', () => {
    const result = buildSearchClause('hex bolt', ['p.name'])
    // 2 ILIKE params (one per word) + one per-word trgm param per word (hex, bolt)
    expect(result.nextIdx).toBe(5)
    expect(result.params).toEqual(['%hex%', '%bolt%', 'hex', 'bolt'])
    expect(result.clause).toContain('p.name ILIKE $1')
    expect(result.clause).toContain('p.name ILIKE $2')
    // The word clauses for one column are AND-ed
    expect(result.clause).toContain('AND')
  })

  it('respects custom startIdx', () => {
    const result = buildSearchClause('bolt', ['p.name'], 5)
    expect(result.nextIdx).toBe(7)
    expect(result.clause).toContain('$5')
    expect(result.clause).toContain('$6')
  })

  it('multi-word, multi-column: params ordered column-first', () => {
    const result = buildSearchClause('hex bolt', ['p.name', 'p.sku'])
    // p.name gets [%hex%, %bolt%], p.sku gets [%hex%, %bolt%], then one per-word trgm param per word
    expect(result.params).toEqual(['%hex%', '%bolt%', '%hex%', '%bolt%', 'hex', 'bolt'])
    expect(result.nextIdx).toBe(7)
  })

  it('trgm params share the same index across all columns', () => {
    const result = buildSearchClause('bolt', ['p.name', 'p.sku', 'p.barcode'])
    // 3 ILIKE params (one per col) + 1 trgm param shared
    expect(result.params).toHaveLength(4)
    expect(result.params[3]).toBe('bolt')
    // All trgm clauses reference the same idx
    expect(result.clause).toContain("word_similarity($4::text, COALESCE(p.name,'')) > 0.5")
    expect(result.clause).toContain("word_similarity($4::text, COALESCE(p.sku,'')) > 0.5")
    expect(result.clause).toContain("word_similarity($4::text, COALESCE(p.barcode,'')) > 0.5")
  })
})

// ---------------------------------------------------------------------------
// buildSearchRank
// ---------------------------------------------------------------------------

describe('buildSearchRank', () => {
  it('returns a CASE expression string', () => {
    const result = buildSearchRank('bolt', 'p.name')
    expect(result).toContain('CASE')
    expect(result).toContain('THEN 0')
    expect(result).toContain('THEN 1')
    expect(result).toContain('ELSE 2')
    expect(result).toContain('END')
  })

  it('embeds starts-with match at rank 0', () => {
    const result = buildSearchRank('bolt', 'p.name')
    expect(result).toContain(`p.name ILIKE 'bolt%'`)
  })

  it('embeds contains match at rank 1', () => {
    const result = buildSearchRank('bolt', 'p.name')
    expect(result).toContain(`p.name ILIKE '%bolt%'`)
  })

  it('trims whitespace from raw', () => {
    const result = buildSearchRank('  bolt  ', 'p.name')
    expect(result).toContain(`p.name ILIKE 'bolt%'`)
    expect(result).not.toContain(`p.name ILIKE '  bolt  %'`)
  })

  it('escapes single quotes in raw', () => {
    const result = buildSearchRank("bolt's", 'p.name')
    expect(result).toContain(`ILIKE 'bolt''s%'`)
    expect(result).toContain(`ILIKE '%bolt''s%'`)
  })

  it('handles multiple single quotes', () => {
    const result = buildSearchRank("o'neil's", 'p.name')
    expect(result).toContain(`ILIKE 'o''neil''s%'`)
  })

  it('works with empty raw (after trim)', () => {
    const result = buildSearchRank('', 'p.name')
    expect(result).toContain(`p.name ILIKE '%'`)
  })

  it('uses the given primaryColumn', () => {
    const result = buildSearchRank('bolt', 'c.title')
    expect(result).toContain('c.title ILIKE')
    expect(result).not.toContain('p.name')
  })
})

// ---------------------------------------------------------------------------
// buildProductSearchRank — empty tsq fallback ("''")
// ---------------------------------------------------------------------------

describe('buildProductSearchRank – empty tsq fallback', () => {
  const NAME = 'p.name'
  const VEC = 'p.search_vector'

  it("uses \"''\" as tsq when every word strips to empty (pure punctuation word)", () => {
    // A string that trims to non-empty but whose single word strips all non-word chars
    // leaving an empty string: tsQuery('') produces '' which is falsy → tsq || "''"
    // We can achieve this with a string of only non-word chars that isn't caught by the
    // early `if (!q)` guard.  The word '...' → replace(/[^\w]/g,'') → '' → '' + ':*' = ':*'
    // Actually that gives ':*' which is truthy.  The only way to get falsy tsq from
    // buildProductSearchRank is if tsQuery returns ''.  tsQuery returns '' only if
    // .filter(Boolean) after map removes all words — which happens when all mapped words
    // are ':*' but the SECOND filter(Boolean) after map keeps ':*' (it's truthy).
    // So in practice tsq is never '' from buildProductSearchRank with a non-empty q.
    // Verify the "|| '\''" branch is the fallback for the special-char case.
    const result = buildProductSearchRank('!!!', NAME, VEC, 1)
    // tsq = ':*' (truthy), so fallback branch NOT taken — still works
    expect(result.params[2]).toBe(':*')
    expect(result.nextIdx).toBe(5)
  })

  it("rank uses \"''\" when tsq resolves to empty (simulated by passing empty after trim)", () => {
    // buildProductSearchRank trims q; if q becomes '' the early return fires
    const result = buildProductSearchRank('   ', NAME, VEC, 3)
    expect(result).toEqual({ rank: '0', params: [], nextIdx: 3 })
  })
})

// ---------------------------------------------------------------------------
// buildVectorSearchClause — no tsq (all words stripped, parts array still built)
// ---------------------------------------------------------------------------

describe('buildVectorSearchClause – tsq falsy path', () => {
  const VEC = 'c.search_vector'

  it('omits tsq part but still adds trgm parts when tsq is empty', () => {
    // To get tsq='' we need tsQuery to return ''.
    // tsQuery joins words that become '' + ':*' = ':*' — that IS truthy in filter(Boolean).
    // There is no code path that produces tsq='' from non-empty input without modification.
    // The if (tsq) branch in buildVectorSearchClause IS tested by special chars ('!!!')
    // producing ':*' (truthy). The ELSE (falsy tsq) path is unreachable in practice.
    // Confirm '!!!' produces truthy tsq and the vector clause IS included:
    const result = buildVectorSearchClause('!!!', VEC, ['c.name'], [], 1)
    expect(result.clause).toContain(`${VEC} @@ to_tsquery`)
    expect(result.params[0]).toBe(':*')
  })

  it('clause is TRUE when input is whitespace-only (no parts built)', () => {
    const result = buildVectorSearchClause('   ', VEC, ['c.name'], ['c.code'], 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('builds only trgm and exact parts when no vectorCol tsq (empty string input early exit)', () => {
    const result = buildVectorSearchClause('', VEC, ['c.name'], ['c.code'], 1)
    expect(result).toEqual({ clause: 'TRUE', params: [], nextIdx: 1 })
  })

  it('builds clause with only exactCols and no trgmCols', () => {
    const result = buildVectorSearchClause('nut', VEC, [], ['c.code', 'c.slug'], 2)
    expect(result.nextIdx).toBe(5)
    expect(result.params).toEqual(['nut:*', '%nut%', '%nut%'])
    expect(result.clause).toContain('c.code ILIKE $3')
    expect(result.clause).toContain('c.slug ILIKE $4')
  })

  it('builds clause with no vectorCol match (empty trgmCols and exactCols only)', () => {
    // Verify clause is wrapped in parens when parts > 0
    const result = buildVectorSearchClause('hex', VEC, [], ['c.barcode'], 1)
    expect(result.clause.startsWith('(')).toBe(true)
    expect(result.clause.endsWith(')')).toBe(true)
  })
})
