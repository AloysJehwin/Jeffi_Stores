import 'server-only'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { atLeast, fileLevel, folderLevel, visibleFolderSql, type DriveActor } from './access'
import { toDriveFile, type DriveFileRow } from './files'
import type { DriveFile, DriveKind, DriveLevel } from './types'

// Listing and searching Drive files, and the file operations behind the Drive page and pickers.

const FILE_SELECT = `
  SELECT df.*, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS uploader_name
    FROM drive_files df
    LEFT JOIN admins a ON a.id = df.uploaded_by_admin_id
    LEFT JOIN users u ON u.id = a.user_id`

export interface ListOpts {
  search?: string | null
  kind?: DriveKind | null
  limit: number
  offset: number
}

const withAccess = (r: DriveFileRow, access: DriveLevel): DriveFile => ({ ...toDriveFile(r), access, deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null })

/** Files in one folder the actor can open. */
export async function listFolderFiles(actor: DriveActor, folderId: string, o: ListOpts): Promise<{ files: DriveFile[]; total: number } | null> {
  const level = await folderLevel(actor, folderId)
  if (!level) return null
  const params: unknown[] = [folderId]
  const where = ['df.folder_id = $1', 'df.deleted_at IS NULL']
  if (o.kind) where.push(`df.kind = $${params.push(o.kind)}`)
  if (o.search?.trim()) where.push(`df.name ILIKE $${params.push(`%${o.search.trim()}%`)}`)
  const rows = await queryMany<DriveFileRow>(`${FILE_SELECT} WHERE ${where.join(' AND ')} ORDER BY df.created_at DESC LIMIT ${o.limit} OFFSET ${o.offset}`, params)
  const total = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM drive_files df WHERE ${where.join(' AND ')}`, params)
  return {
    files: rows.map(r => withAccess(r, r.uploaded_by_admin_id === actor.adminId && atLeast(level, 'edit') ? 'manage' : level)),
    total: Number(total?.n ?? 0),
  }
}

/** Search (or browse recent) across everything the actor can see; `trash` lists their deleted files. */
export async function searchFiles(actor: DriveActor, o: ListOpts & { trash?: boolean }): Promise<{ files: DriveFile[]; total: number }> {
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  const me = p(actor.adminId)
  const role = p(actor.role)
  const where = [o.trash ? 'df.deleted_at IS NOT NULL' : 'df.deleted_at IS NULL']
  where.push(`(df.uploaded_by_admin_id = ${me}
     OR EXISTS (SELECT 1 FROM drive_shares s WHERE s.file_id = df.id AND (s.grantee_admin_id = ${me} OR s.grantee_role = ${role}))
     OR EXISTS (SELECT 1 FROM drive_folders f WHERE f.id = df.folder_id AND f.deleted_at IS NULL AND ${visibleFolderSql(actor, p)}))`)
  if (o.kind) where.push(`df.kind = ${p(o.kind)}`)
  if (o.search?.trim()) where.push(`df.name ILIKE ${p(`%${o.search.trim()}%`)}`)
  const rows = await queryMany<DriveFileRow>(`${FILE_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(df.deleted_at, df.created_at) DESC LIMIT ${o.limit} OFFSET ${o.offset}`, params)
  const total = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM drive_files df WHERE ${where.join(' AND ')}`, params)
  const files: DriveFile[] = []
  for (const r of rows) {
    const level = await fileLevel(actor, r)
    if (level) files.push(withAccess(r, level))
  }
  return { files, total: Number(total?.n ?? 0) }
}

/** The file plus the actor's level on it (deleted files only for whoever may restore them). */
export async function fileFor(actor: DriveActor, id: string, opts: { withDeleted?: boolean } = {}): Promise<{ row: DriveFileRow; level: DriveLevel } | null> {
  const row = await queryOne<DriveFileRow>(`${FILE_SELECT} WHERE df.id = $1 ${opts.withDeleted ? '' : 'AND df.deleted_at IS NULL'}`, [id]).catch(() => null)
  if (!row) return null
  const level = await fileLevel(actor, row)
  return level ? { row, level } : null
}

export async function renameFile(id: string, name: string): Promise<void> {
  const clean = name.replace(/[\\/\r\n\t\0]/g, '_').trim().slice(0, 200)
  if (clean) await query(`UPDATE drive_files SET name = $2, updated_at = now() WHERE id = $1`, [id, clean])
}

export async function moveFile(id: string, folderId: string | null): Promise<void> {
  await query(`UPDATE drive_files SET folder_id = $2, updated_at = now() WHERE id = $1`, [id, folderId])
}

export async function trashFile(id: string): Promise<void> {
  await query(`UPDATE drive_files SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id])
}

/** Back from the trash; into the root when its folder was deleted too. */
export async function restoreFile(id: string): Promise<void> {
  await query(
    `UPDATE drive_files df SET deleted_at = NULL,
            folder_id = CASE WHEN EXISTS (SELECT 1 FROM drive_folders f WHERE f.id = df.folder_id AND f.deleted_at IS NULL) THEN df.folder_id ELSE NULL END
      WHERE id = $1`,
    [id]
  )
}
