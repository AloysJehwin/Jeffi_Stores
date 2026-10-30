import 'server-only'
import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import type { DriveLevel } from './types'

// Who may do what in the Drive. Scopes gate the Drive as a whole (drive:read to browse, drive:write
// to change anything); folders then decide per item: the owner manages, a `team` folder is open to
// everyone with drive access, and explicit shares (to an admin or a role) grant view/edit/manage.
// Shares on a parent folder carry down to everything inside it. Administrators manage everything.

export interface DriveActor {
  adminId: string
  role: string
  scopes: string[]
}

const RANK: Record<DriveLevel, number> = { view: 1, edit: 2, manage: 3 }
export const atLeast = (have: DriveLevel | null, need: DriveLevel) => !!have && RANK[have] >= RANK[need]
const max = (a: DriveLevel | null, b: DriveLevel | null): DriveLevel | null => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b)

export const canRead = (a: DriveActor) => hasScope(a.role, a.scopes, 'drive:read')
export const canWrite = (a: DriveActor) => hasScope(a.role, a.scopes, 'drive:write')
const isAdministrator = (a: DriveActor) => a.role === 'administrator'

/** Cap a granted level by the actor's scopes: without drive:write nothing above view. */
function capped(a: DriveActor, level: DriveLevel | null): DriveLevel | null {
  if (!level || !canRead(a)) return null
  return canWrite(a) ? level : 'view'
}

/** The actor's level on a folder (null = no access), walking up for inherited shares. */
export async function folderLevel(a: DriveActor, folderId: string): Promise<DriveLevel | null> {
  if (!canRead(a)) return null
  if (isAdministrator(a)) return 'manage'
  const chain = await queryMany<{ id: string; owner_admin_id: string | null; visibility: string; depth: number }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, owner_admin_id, visibility, 0 AS depth FROM drive_folders WHERE id = $1 AND deleted_at IS NULL
       UNION ALL
       SELECT f.id, f.parent_id, f.owner_admin_id, f.visibility, up.depth + 1
         FROM drive_folders f JOIN up ON f.id = up.parent_id
        WHERE f.deleted_at IS NULL AND up.depth < 32
     ) SELECT id, owner_admin_id, visibility, depth FROM up`,
    [folderId]
  )
  if (!chain.length) return null
  let level: DriveLevel | null = null
  for (const f of chain) {
    if (f.owner_admin_id === a.adminId) level = max(level, 'manage')
    if (f.visibility === 'team') level = max(level, 'edit')
  }
  const shares = await queryMany<{ level: DriveLevel }>(
    `SELECT level FROM drive_shares WHERE folder_id = ANY($1::uuid[]) AND (grantee_admin_id = $2 OR grantee_role = $3)`,
    [chain.map(c => c.id), a.adminId, a.role]
  )
  for (const s of shares) level = max(level, s.level)
  return capped(a, level)
}

/** A file's level: its folder's, raised by any share on the file itself. */
export async function fileLevel(a: DriveActor, file: { id: string; folder_id: string | null; uploaded_by_admin_id: string | null }): Promise<DriveLevel | null> {
  if (!canRead(a)) return null
  if (isAdministrator(a)) return 'manage'
  let level: DriveLevel | null = file.folder_id ? await folderLevel(a, file.folder_id) : null
  if (file.uploaded_by_admin_id === a.adminId) level = max(level, 'manage')
  const share = await queryOne<{ level: DriveLevel }>(
    `SELECT level FROM drive_shares WHERE file_id = $1 AND (grantee_admin_id = $2 OR grantee_role = $3)
      ORDER BY CASE level WHEN 'manage' THEN 3 WHEN 'edit' THEN 2 ELSE 1 END DESC LIMIT 1`,
    [file.id, a.adminId, a.role]
  )
  return capped(a, max(level, share?.level ?? null))
}

/** SQL predicate (on alias `f`, a drive_folders row) for folders the actor can see at all. */
export function visibleFolderSql(a: DriveActor, param: (v: unknown) => string): string {
  if (isAdministrator(a)) return 'true'
  const me = param(a.adminId)
  const role = param(a.role)
  return `(f.visibility = 'team' OR f.owner_admin_id = ${me} OR EXISTS (
            WITH RECURSIVE up AS (
              SELECT f.id AS id, f.parent_id AS parent_id, 0 AS depth
              UNION ALL
              SELECT p.id, p.parent_id, up.depth + 1 FROM drive_folders p JOIN up ON p.id = up.parent_id WHERE up.depth < 32
            )
            SELECT 1 FROM drive_shares s JOIN up ON s.folder_id = up.id
             WHERE s.grantee_admin_id = ${me} OR s.grantee_role = ${role}))`
}
