import { outreachPool, type Queryable } from './db'
import { recordEvent } from './events'
import type { ListSource, OutreachList } from './types'

export type OutreachListRow = OutreachList & { skill_title: string | null }

export class ListError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export async function listLists(program: string): Promise<OutreachListRow[]> {
  const r = await outreachPool().query(
    `SELECT l.*, s.title AS skill_title FROM outreach_lists l LEFT JOIN outreach_skills s ON s.id = l.skill_id WHERE l.program = $1 ORDER BY l.created_at DESC`,
    [program]
  )
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

/** Picks the list's skill (null clears it) and optionally pins one of its versions. */
export async function setListSkill(id: string, skillId: string | null, versionId: string | null, actor: string | null = null): Promise<OutreachList> {
  const pool = outreachPool()
  const list = await getList(id)
  if (!list) throw new ListError('List not found', 404)
  if (!skillId) {
    const r = await pool.query(`UPDATE outreach_lists SET skill_id = NULL, skill_version_id = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [id])
    await recordEvent(null, 'list_skill_set', { actor, data: { listId: id, skillId: null, versionId: null } })
    return r.rows[0]
  }
  const sk = (await pool.query(`SELECT program, archived_at FROM outreach_skills WHERE id = $1`, [skillId])).rows[0] as { program: string; archived_at: unknown } | undefined
  if (!sk) throw new ListError('Unknown skill', 400)
  if (sk.archived_at) throw new ListError('That skill is archived', 400)
  if (sk.program !== list.program) throw new ListError('That skill belongs to another program', 400)
  if (versionId) {
    const v = await pool.query(`SELECT 1 FROM outreach_skill_versions WHERE id = $1 AND skill_id = $2`, [versionId, skillId])
    if (!v.rows.length) throw new ListError('That version does not belong to the skill', 400)
  }
  const r = await pool.query(`UPDATE outreach_lists SET skill_id = $2, skill_version_id = $3, updated_at = now() WHERE id = $1 RETURNING *`, [id, skillId, versionId ?? null])
  await recordEvent(null, 'list_skill_set', { actor, data: { listId: id, skillId, versionId: versionId ?? null } })
  return r.rows[0]
}
