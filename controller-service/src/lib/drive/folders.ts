import 'server-only'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { folderLevel, visibleFolderSql, type DriveActor } from './access'
import type { DriveFolder, DriveLevel, DriveShare, DriveVisibility } from './types'

// Folders. System folders (Support, Agent uploads, each admin's My files) are created on first use
// and keyed by system_key so concurrent first uses converge on one row.

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  owner_admin_id: string | null
  visibility: DriveVisibility
  system_key: string | null
  created_at: string
  owner_name?: string | null
  file_count?: string | null
}

function toFolder(r: FolderRow, access: DriveLevel): DriveFolder {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    visibility: r.visibility,
    systemKey: r.system_key,
    ownerAdminId: r.owner_admin_id,
    ownerName: r.owner_name ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    access,
    fileCount: r.file_count != null ? Number(r.file_count) : undefined,
  }
}

/** One folder per system key, created on first use. */
export async function ensureSystemFolder(
  key: string,
  name: string,
  opts: { parentId?: string | null; visibility?: DriveVisibility; ownerAdminId?: string | null } = {}
): Promise<string> {
  const existing = await queryOne<{ id: string }>(`SELECT id FROM drive_folders WHERE system_key = $1`, [key])
  if (existing) return existing.id
  const row = await queryOne<{ id: string }>(
    `INSERT INTO drive_folders (parent_id, name, owner_admin_id, visibility, system_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO UPDATE SET updated_at = drive_folders.updated_at
     RETURNING id`,
    [opts.parentId ?? null, name.slice(0, 160), opts.ownerAdminId ?? null, opts.visibility ?? 'team', key]
  )
  return row!.id
}

/** Support/<ticket>: where a chat's files live. */
export async function supportFolder(ticket: string | null, sessionId: string): Promise<string> {
  const root = await ensureSystemFolder('support', 'Support', { visibility: 'team' })
  return ensureSystemFolder(`support:${sessionId}`, ticket || `Chat ${sessionId.slice(0, 8)}`, { parentId: root, visibility: 'team' })
}

export async function agentFolder(adminId: string): Promise<string> {
  const root = await ensureSystemFolder('agent', 'Agent uploads', { visibility: 'private' })
  return ensureSystemFolder(`agent:${adminId}`, 'My agent uploads', { parentId: root, visibility: 'private', ownerAdminId: adminId })
}

export async function homeFolder(adminId: string): Promise<string> {
  return ensureSystemFolder(`home:${adminId}`, 'My files', { visibility: 'private', ownerAdminId: adminId })
}

const FOLDER_SELECT = `
  SELECT f.*, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS owner_name,
         (SELECT count(*) FROM drive_files df WHERE df.folder_id = f.id AND df.deleted_at IS NULL) AS file_count
    FROM drive_folders f
    LEFT JOIN admins a ON a.id = f.owner_admin_id
    LEFT JOIN users u ON u.id = a.user_id`

/** Child folders the actor can see (parent null = top level), each with the actor's level. */
export async function listFolders(actor: DriveActor, parentId: string | null): Promise<DriveFolder[]> {
  const params: unknown[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }
  const parent = parentId ? `f.parent_id = ${p(parentId)}` : `f.parent_id IS NULL`
  // Inside a folder the actor can open, every child is visible through inheritance.
  const vis = parentId && (await folderLevel(actor, parentId)) ? 'true' : visibleFolderSql(actor, p)
  const rows = await queryMany<FolderRow>(
    `${FOLDER_SELECT} WHERE ${parent} AND f.deleted_at IS NULL AND ${vis}
      ORDER BY (f.system_key IS NOT NULL) DESC, lower(f.name)`,
    params
  )
  const out: DriveFolder[] = []
  for (const r of rows) {
    const level = await folderLevel(actor, r.id)
    if (level) out.push(toFolder(r, level))
  }
  return out
}

export async function getFolder(actor: DriveActor, id: string): Promise<DriveFolder | null> {
  const r = await queryOne<FolderRow>(`${FOLDER_SELECT} WHERE f.id = $1 AND f.deleted_at IS NULL`, [id])
  if (!r) return null
  const level = await folderLevel(actor, id)
  return level ? toFolder(r, level) : null
}

/** Root → folder, for breadcrumbs. */
export async function folderPath(id: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await queryMany<{ id: string; name: string; depth: number }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, name, 0 AS depth FROM drive_folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM drive_folders f JOIN up ON f.id = up.parent_id WHERE up.depth < 32
     ) SELECT id, name, depth FROM up ORDER BY depth DESC`,
    [id]
  )
  return rows.map(r => ({ id: r.id, name: r.name }))
}

export async function createFolder(actor: DriveActor, p: { parentId: string | null; name: string; visibility: DriveVisibility }): Promise<DriveFolder> {
  const row = await queryOne<FolderRow>(
    `INSERT INTO drive_folders (parent_id, name, owner_admin_id, visibility) VALUES ($1, $2, $3, $4) RETURNING *`,
    [p.parentId, p.name.trim().slice(0, 160), actor.adminId, p.visibility]
  )
  return toFolder(row!, 'manage')
}

export async function updateFolder(id: string, set: { name?: string; visibility?: DriveVisibility; parentId?: string | null }): Promise<void> {
  if (set.name !== undefined) await query(`UPDATE drive_folders SET name = $2, updated_at = now() WHERE id = $1 AND system_key IS NULL`, [id, set.name.trim().slice(0, 160)])
  if (set.visibility) await query(`UPDATE drive_folders SET visibility = $2, updated_at = now() WHERE id = $1 AND system_key IS NULL`, [id, set.visibility])
  if (set.parentId !== undefined) await query(`UPDATE drive_folders SET parent_id = $2, updated_at = now() WHERE id = $1 AND system_key IS NULL`, [id, set.parentId])
}

/** Soft-delete a folder and everything under it. System folders can't be deleted. */
export async function trashFolder(id: string): Promise<boolean> {
  const r = await queryOne<{ system_key: string | null }>(`SELECT system_key FROM drive_folders WHERE id = $1`, [id])
  if (!r || r.system_key) return false
  await query(
    `WITH RECURSIVE down AS (
       SELECT id FROM drive_folders WHERE id = $1
       UNION ALL SELECT f.id FROM drive_folders f JOIN down ON f.parent_id = down.id
     ),
     folders AS (UPDATE drive_folders SET deleted_at = now() WHERE id IN (SELECT id FROM down) AND deleted_at IS NULL RETURNING id)
     UPDATE drive_files SET deleted_at = now() WHERE folder_id IN (SELECT id FROM down) AND deleted_at IS NULL`,
    [id]
  )
  return true
}

/** Is `candidate` the folder itself or one of its descendants (moving into it would loop)? */
export async function isWithin(candidate: string, folderId: string): Promise<boolean> {
  const r = await queryOne(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, 0 AS depth FROM drive_folders WHERE id = $1
       UNION ALL SELECT f.id, f.parent_id, up.depth + 1 FROM drive_folders f JOIN up ON f.id = up.parent_id WHERE up.depth < 32
     ) SELECT 1 FROM up WHERE id = $2 LIMIT 1`,
    [candidate, folderId]
  )
  return !!r
}

export async function listShares(target: { folderId?: string; fileId?: string }): Promise<DriveShare[]> {
  const rows = await queryMany<{ id: string; grantee_admin_id: string | null; grantee_role: string | null; level: DriveLevel; name: string | null }>(
    `SELECT s.id, s.grantee_admin_id, s.grantee_role, s.level,
            NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS name
       FROM drive_shares s
       LEFT JOIN admins a ON a.id = s.grantee_admin_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${target.folderId ? 's.folder_id = $1' : 's.file_id = $1'}
      ORDER BY s.created_at`,
    [target.folderId ?? target.fileId]
  )
  return rows.map(r => ({ id: r.id, adminId: r.grantee_admin_id, adminName: r.name, role: r.grantee_role, level: r.level }))
}

export async function addShare(
  target: { folderId?: string; fileId?: string },
  grantee: { adminId?: string; role?: string },
  level: DriveLevel,
  by: string
): Promise<void> {
  await query(
    `DELETE FROM drive_shares WHERE ${target.folderId ? 'folder_id' : 'file_id'} = $1
        AND (grantee_admin_id = $2 OR grantee_role = $3)`,
    [target.folderId ?? target.fileId, grantee.adminId ?? null, grantee.role ?? null]
  )
  await query(
    `INSERT INTO drive_shares (folder_id, file_id, grantee_admin_id, grantee_role, level, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [target.folderId ?? null, target.fileId ?? null, grantee.adminId ?? null, grantee.role ?? null, level, by]
  )
}

export async function removeShare(shareId: string): Promise<{ folder_id: string | null; file_id: string | null } | null> {
  return queryOne(`DELETE FROM drive_shares WHERE id = $1 RETURNING folder_id, file_id`, [shareId])
}
