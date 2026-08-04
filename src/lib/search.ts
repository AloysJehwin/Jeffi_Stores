export interface SearchClause {
  clause: string
  params: unknown[]
  nextIdx: number
}

// Minimum pg_trgm word_similarity for a query word to be considered a fuzzy
// match against the best-matching run of words in a column. Calibrated against
// the live catalogue: genuine typos ("screwdrivr"→Screwdriver, "grindr"→Grinder)
// score 0.7-0.82, while unrelated terms stay well below. word_similarity (unlike
// plain similarity) compares a short query word to the closest substring of a
// long product name, so it tolerates typos that whole-string similarity misses.
const WORD_SIM_THRESHOLD = 0.5

// Split a raw query into clean, non-empty word tokens (punctuation stripped).
function searchWords(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(Boolean)
}

function tsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.replace(/[^\w]/g, '') + ':*')
    .filter(Boolean)
    .join(' & ')
}

export function buildProductSearchClause(
  raw: string,
  nameCol: string,
  skuCol: string,
  vectorCol: string,
  startIdx: number
): SearchClause {
  const q = raw.trim()
  if (!q) return { clause: 'TRUE', params: [], nextIdx: startIdx }

  const tsq = tsQuery(q)
  if (!tsq) return { clause: 'TRUE', params: [], nextIdx: startIdx }

  const params: unknown[] = []
  let i = startIdx
  const parts: string[] = []

  // Full-text prefix search (fast, index-backed).
  parts.push(`${vectorCol} @@ to_tsquery('english', $${i})`); params.push(tsq); i++
  // Whole-query fuzzy fallback.
  parts.push(`similarity(${nameCol}, $${i}::text) > 0.12`); params.push(q); i++
  // SKU prefix.
  parts.push(`${skuCol} ILIKE $${i}`); params.push(`${q}%`); i++
  // Per-word fuzzy match — tolerates a typo in any single word (e.g. "screwdrivr").
  for (const w of searchWords(q)) {
    parts.push(`word_similarity($${i}::text, ${nameCol}) > ${WORD_SIM_THRESHOLD}`)
    params.push(w); i++
  }

  return { clause: `(${parts.join(' OR ')})`, params, nextIdx: i }
}

export function buildProductSearchRank(
  raw: string,
  nameCol: string,
  vectorCol: string,
  startIdx: number
): { rank: string; params: unknown[]; nextIdx: number } {
  const q = raw.trim()
  if (!q) return { rank: '0', params: [], nextIdx: startIdx }

  const tsq = tsQuery(q)
  let i = startIdx
  // Lower = better (ORDER BY ascending). Exact prefix/substring win first; then
  // full-text rank; then trigram word similarity so fuzzy hits still order well.
  const rank = `(
    CASE WHEN ${nameCol} ILIKE $${i} THEN 0 ELSE 2 END
    + CASE WHEN ${nameCol} ILIKE $${i + 1} THEN 0 ELSE 1 END
    - ts_rank_cd(${vectorCol}, to_tsquery('english', $${i + 2}))
    - word_similarity($${i + 3}::text, ${nameCol})
  )`
  return {
    rank,
    params: [`${q}%`, `%${q}%`, tsq || "''", q],
    nextIdx: i + 4,
  }
}

export function buildVectorSearchClause(
  raw: string,
  vectorCol: string,
  trgmCols: string[],
  exactCols: string[],
  startIdx: number,
  ftsConfig: 'english' | 'simple' = 'simple'
): SearchClause {
  const q = raw.trim()
  if (!q) return { clause: 'TRUE', params: [], nextIdx: startIdx }

  const params: unknown[] = []
  let i = startIdx
  const parts: string[] = []

  const tsq = tsQuery(q)
  if (tsq) {
    parts.push(`${vectorCol} @@ to_tsquery('${ftsConfig}', $${i})`)
    params.push(tsq)
    i++
  }

  for (const col of trgmCols) {
    parts.push(`similarity(${col}, $${i}::text) > 0.12`)
    params.push(q)
    i++
  }

  for (const col of exactCols) {
    parts.push(`${col} ILIKE $${i}`)
    params.push(`%${q}%`)
    i++
  }

  const clause = parts.length ? `(${parts.join(' OR ')})` : 'TRUE'
  return { clause, params, nextIdx: i }
}

export function buildSearchClause(
  raw: string,
  columns: string[],
  startIdx: number = 1
): SearchClause {
  const words = searchWords(raw)
  if (words.length === 0) {
    return { clause: 'TRUE', params: [], nextIdx: startIdx }
  }

  const params: unknown[] = []
  let idx = startIdx

  // Exact: every word must appear (as a substring) somewhere across the columns.
  const colClauses = columns.map(col => {
    const wordClauses = words.map(word => {
      params.push(`%${word}%`)
      return `${col} ILIKE $${idx++}`
    })
    return `(${wordClauses.join(' AND ')})`
  })

  // Fuzzy: per-word trigram word_similarity against each column, so a typo in any
  // single word still matches (e.g. "grindr" → "Wet Grinder").
  const trgmClauses: string[] = []
  for (const word of words) {
    params.push(word)
    const wi = idx++
    for (const col of columns) {
      trgmClauses.push(`word_similarity($${wi}::text, COALESCE(${col},'')) > ${WORD_SIM_THRESHOLD}`)
    }
  }

  const clause = `(${colClauses.join(' OR ')} OR ${trgmClauses.join(' OR ')})`
  return { clause, params, nextIdx: idx }
}

export function buildSearchRank(raw: string, primaryColumn: string): string {
  const escaped = raw.trim().replace(/'/g, "''")
  // Lower = better. Exact prefix/substring rank first; then subtract the best
  // per-column word_similarity so fuzzy matches still order by relevance.
  return `(CASE
    WHEN ${primaryColumn} ILIKE '${escaped}%' THEN 0
    WHEN ${primaryColumn} ILIKE '%${escaped}%' THEN 1
    ELSE 2
  END - word_similarity('${escaped}', COALESCE(${primaryColumn},'')))`
}
