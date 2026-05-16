export interface SearchClause {
  clause: string
  params: unknown[]
  nextIdx: number
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

  const i = startIdx
  const clause = `(
    ${vectorCol} @@ to_tsquery('english', $${i})
    OR similarity(${nameCol}, $${i + 1}::text) > 0.12
    OR ${skuCol} ILIKE $${i + 2}
  )`
  return { clause, params: [tsq, q, `${q}%`], nextIdx: i + 3 }
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
  const i = startIdx
  const rank = `(
    CASE WHEN ${nameCol} ILIKE $${i} THEN 0 ELSE 2 END
    + CASE WHEN ${nameCol} ILIKE $${i + 1} THEN 0 ELSE 1 END
    - ts_rank_cd(${vectorCol}, to_tsquery('english', $${i + 2}))
  )`
  return {
    rank,
    params: [`${q}%`, `%${q}%`, tsq || "''"],
    nextIdx: i + 3,
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
  const words = raw.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return { clause: 'TRUE', params: [], nextIdx: startIdx }
  }

  const params: unknown[] = []
  let idx = startIdx

  const colClauses = columns.map(col => {
    const wordClauses = words.map(word => {
      params.push(`%${word}%`)
      return `${col} ILIKE $${idx++}`
    })
    return `(${wordClauses.join(' AND ')})`
  })

  const trgmClauses = columns.map(col => `similarity(${col}, $${idx}::text) > 0.12`)
  params.push(raw.trim())
  idx++

  const clause = `(${colClauses.join(' OR ')} OR ${trgmClauses.join(' OR ')})`
  return { clause, params, nextIdx: idx }
}

export function buildSearchRank(raw: string, primaryColumn: string): string {
  const escaped = raw.trim().replace(/'/g, "''")
  return `CASE
    WHEN ${primaryColumn} ILIKE '${escaped}%' THEN 0
    WHEN ${primaryColumn} ILIKE '%${escaped}%' THEN 1
    ELSE 2
  END`
}
