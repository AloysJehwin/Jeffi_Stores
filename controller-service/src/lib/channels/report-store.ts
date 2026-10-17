import type { PoolClient } from 'pg'
import { bulkInsert } from '@/lib/google-ads/sync'

export { bulkInsert }

type Db = Pick<PoolClient, 'query'>

/** Replace rows of a date-keyed report table inside [from, to] in one transaction (rows Google or
 * Amazon stop reporting must not linger). `where` narrows the delete further, e.g. one account. */
export async function replaceDateRange(
  db: Db,
  table: string,
  range: { from: string; to: string },
  cols: string[],
  rows: unknown[][],
  dateCol = 'date'
): Promise<number> {
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM ${table} WHERE ${dateCol} BETWEEN $1 AND $2`, [range.from, range.to])
    const n = await bulkInsert(db, table, cols, rows as any[][])
    await db.query('COMMIT')
    return n
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
}

/** Replace a whole snapshot table (no date key), e.g. the current account issues. */
export async function replaceAll(db: Db, table: string, cols: string[], rows: unknown[][]): Promise<number> {
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM ${table}`)
    const n = await bulkInsert(db, table, cols, rows as any[][])
    await db.query('COMMIT')
    return n
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
}

export const upsertSet = (cols: string[]) => cols.map(c => `${c}=EXCLUDED.${c}`).join(', ')

/** YYYY-MM-DD in India time, `daysBack` days before `now`. */
export function istDate(now = new Date(), daysBack = 0): string {
  const d = new Date(now.getTime() - daysBack * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}
