import { escapeLike } from './client'

export interface SearchClause {
  clause: string
  params: unknown[]
  nextIdx: number
}

/** Prefix tsquery of the query's words (`bolt:* & m8:*`); empty when nothing word-like is left. */
export function prefixTsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(Boolean)
    .map(w => `${w}:*`)
    .join(' & ')
}

/** Full-text prefix match on `vectorCol`, trigram similarity on `trgmCols`, substring on `exactCols` (escaped). */
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

  const tsq = prefixTsQuery(q)
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
    params.push(`%${escapeLike(q)}%`)
    i++
  }

  const clause = parts.length ? `(${parts.join(' OR ')})` : 'TRUE'
  return { clause, params, nextIdx: i }
}
