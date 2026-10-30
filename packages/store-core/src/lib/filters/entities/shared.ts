import { escapeLike, type ExportColumn, type SearchClause } from '@jeffi/list-filters'

// Small builders shared by the simpler entities.

export const col = (key: string, label: string, sql: string): ExportColumn => ({ key, label, sql })

export const ist = (e: string, time = true) =>
  `to_char(${e} AT TIME ZONE 'Asia/Kolkata', '${time ? 'YYYY-MM-DD HH24:MI' : 'YYYY-MM-DD'}')`

/** A keyset column that may be NULL (old rows): NULLs sort first instead of ending the export. */
export const nullableTs = (e: string) => `COALESCE(${e}, 'epoch'::timestamptz)`

export const yesNo = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`

/** Escaped substring match of one param over several expressions. */
export function containsSearch(exprs: string[], q: string, idx: number): SearchClause {
  const p = `$${idx}`
  return {
    clause: `(${exprs.map(e => `${e} ILIKE ${p}`).join(' OR ')})`,
    params: [`%${escapeLike(q.trim())}%`],
    nextIdx: idx + 1,
  }
}
