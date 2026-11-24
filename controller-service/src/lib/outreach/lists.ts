import { outreachPool, type Queryable } from './db'
import type { ListSource, OutreachList } from './types'

export async function listLists(program: string): Promise<OutreachList[]> {
  const r = await outreachPool().query(`SELECT * FROM outreach_lists WHERE program = $1 ORDER BY created_at DESC`, [program])
  return r.rows
}

export async function getList(id: string): Promise<OutreachList | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_lists WHERE id = $1`, [id])
  return r.rows[0] ?? null
}

export async function createList(
  input: { program: string; name: string; source: ListSource; spreadsheetId?: string | null; sheetTitle?: string | null; createdBy?: string | null },
  db: Queryable = outreachPool()
): Promise<OutreachList> {
  const r = await db.query(
    `INSERT INTO outreach_lists (program, name, source, spreadsheet_id, sheet_title, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.program, input.name, input.source, input.spreadsheetId ?? null, input.sheetTitle ?? null, input.createdBy ?? null]
  )
  return r.rows[0]
}

export async function markSynced(id: string, rowCount: number, db: Queryable = outreachPool()): Promise<void> {
  await db.query(`UPDATE outreach_lists SET row_count = $2, last_synced_at = now(), updated_at = now() WHERE id = $1`, [id, rowCount])
}
