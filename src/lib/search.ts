export interface SearchClause {
  clause: string
  params: string[]
  nextIdx: number
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

  const params: string[] = []
  let idx = startIdx

  const colClauses: string[] = []
  for (const col of columns) {
    const wordClauses: string[] = []
    for (const word of words) {
      wordClauses.push(`${col} ILIKE $${idx++}`)
      params.push(`%${word}%`)
    }
    colClauses.push(`(${wordClauses.join(' AND ')})`)
  }

  const trgmClauses: string[] = []
  for (const col of columns) {
    trgmClauses.push(`similarity(${col}, $${idx}) > 0.15`)
  }
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
