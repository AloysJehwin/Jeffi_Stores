import { DRAFT_RESOURCES, type DraftResourceType } from './registry'
import { defaultHasScope, q, toLock, type DraftLock, type HasScopeFn, type SqlClient } from './locks'

/** A viewer drops out after this long without a heartbeat. */
export const PRESENCE_TTL_SECONDS = 45

export interface DraftViewer {
  adminId: string
  name: string | null
  mode: 'view' | 'edit'
  seenAt: string
}

const NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)`

export async function heartbeat(
  c: SqlClient,
  p: { type: DraftResourceType; id: string; adminId: string; tabId: string; mode: 'view' | 'edit'; leaving?: boolean }
): Promise<{ changed: boolean }> {
  if (p.leaving) {
    const r = await q(c, `DELETE FROM draft_presence WHERE resource_type = $1 AND resource_id = $2 AND admin_id = $3 AND tab_id = $4`, [
      p.type,
      p.id,
      p.adminId,
      p.tabId,
    ])
    return { changed: (r.rowCount ?? 0) > 0 }
  }
  // changed = a tab joined (first heartbeat); refreshes are silent.
  const r = await q(c, 
    `INSERT INTO draft_presence (resource_type, resource_id, admin_id, tab_id, mode, seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (resource_type, resource_id, admin_id, tab_id) DO UPDATE SET mode = EXCLUDED.mode, seen_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [p.type, p.id, p.adminId, p.tabId, p.mode]
  )
  return { changed: !!r.rows[0]?.inserted }
}

export async function viewers(c: SqlClient, type: DraftResourceType, id: string): Promise<DraftViewer[]> {
  const r = await q(c, 
    `SELECT p.admin_id, ${NAME} AS name, bool_or(p.mode = 'edit') AS editing, max(p.seen_at) AS seen_at
       FROM draft_presence p
       LEFT JOIN admins a ON a.id = p.admin_id LEFT JOIN users u ON u.id = a.user_id
      WHERE p.resource_type = $1 AND p.resource_id = $2 AND p.seen_at > now() - make_interval(secs => $3)
      GROUP BY p.admin_id, name ORDER BY min(p.seen_at)`,
    [type, id, PRESENCE_TTL_SECONDS]
  )
  return r.rows.map(row => ({
    adminId: row.admin_id,
    name: row.name ?? null,
    mode: row.editing ? 'edit' : 'view',
    seenAt: row.seen_at instanceof Date ? row.seen_at.toISOString() : String(row.seen_at),
  }))
}

export async function viewerCounts(c: SqlClient, keys: { type: DraftResourceType; id: string }[]): Promise<Record<string, number>> {
  if (!keys.length) return {}
  const r = await q(c, 
    `SELECT resource_type || ':' || resource_id AS k, count(DISTINCT admin_id)::int AS n FROM draft_presence
      WHERE (resource_type, resource_id) IN (SELECT * FROM unnest($1::text[], $2::uuid[]))
        AND seen_at > now() - make_interval(secs => $3)
      GROUP BY 1`,
    [keys.map(k => k.type), keys.map(k => k.id), PRESENCE_TTL_SECONDS]
  )
  return Object.fromEntries(r.rows.map(row => [row.k, row.n]))
}

export interface DraftListRow {
  resourceType: DraftResourceType
  resourceId: string
  label: string
  editHref: string
  lock: DraftLock | null
  updatedAt: string | null
}

const LIST_SELECT = `
  SELECT l.*, ${NAME.replace(/u\./g, 'ou.')} AS owner_name, COALESCE(oa.is_active, false) AS owner_active,
         oa.role AS owner_role, oa.scopes AS owner_scopes
    FROM draft_locks l LEFT JOIN admins oa ON oa.id = l.owner_admin_id LEFT JOIN users ou ON ou.id = oa.user_id`

async function labels(c: SqlClient, rows: { resourceType: DraftResourceType; resourceId: string }[]) {
  const byType = new Map<DraftResourceType, string[]>()
  for (const r of rows) byType.set(r.resourceType, [...(byType.get(r.resourceType) ?? []), r.resourceId])
  const out = new Map<string, { label: string; ref: string | null }>()
  for (const [type, ids] of byType) {
    const res = await q(c, DRAFT_RESOURCES[type].labelSql, DRAFT_RESOURCES[type].labelSql.includes('$1') ? [ids] : [])
    for (const r of res.rows) out.set(`${type}:${r.id}`, { label: r.label ?? DRAFT_RESOURCES[type].label, ref: r.ref ?? null })
  }
  return out
}

/**
 * The drafts dashboard. `mine` = locks the admin holds, `all` = every held lock, `unclaimed` =
 * drafts nobody holds (no lock row yet, or released). `types` limits to what the caller may read.
 */
export async function listDrafts(
  c: SqlClient,
  opts: { scope: 'mine' | 'all' | 'unclaimed'; adminId: string; types: DraftResourceType[]; limit: number; offset: number; hasScope?: HasScopeFn }
): Promise<{ rows: DraftListRow[]; total: number }> {
  const hasScope = opts.hasScope ?? defaultHasScope
  if (!opts.types.length) return { rows: [], total: 0 }
  let base: { resourceType: DraftResourceType; resourceId: string; lock: DraftLock | null; updatedAt: string | null }[] = []
  if (opts.scope === 'unclaimed') {
    for (const type of opts.types) {
      const r = await q(c, 
        `SELECT d.id, d.updated_at FROM (${DRAFT_RESOURCES[type].listSql}) d
          WHERE NOT EXISTS (SELECT 1 FROM draft_locks l WHERE l.resource_type = $1 AND l.resource_id = d.id
                              AND l.closed_at IS NULL AND l.owner_admin_id IS NOT NULL)`,
        [type]
      )
      const open = await q(c, `${LIST_SELECT} WHERE l.resource_type = $1 AND l.closed_at IS NULL AND l.owner_admin_id IS NULL`, [type])
      const released = new Map(open.rows.map(row => [row.resource_id, toLock(row, hasScope)]))
      for (const row of r.rows) {
        base.push({
          resourceType: type,
          resourceId: row.id,
          lock: released.get(row.id) ?? null,
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
        })
      }
    }
    base.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  } else {
    const r = await q(c, 
      `${LIST_SELECT} WHERE l.closed_at IS NULL AND l.resource_type = ANY($1::text[])
          AND ${opts.scope === 'mine' ? 'l.owner_admin_id = $2' : 'l.owner_admin_id IS NOT NULL AND $2::uuid IS NOT NULL'}
        ORDER BY l.last_active_at DESC`,
      [opts.types, opts.adminId]
    )
    base = r.rows.map(row => ({ resourceType: row.resource_type, resourceId: row.resource_id, lock: toLock(row, hasScope), updatedAt: null }))
  }
  const total = base.length
  const page = base.slice(opts.offset, opts.offset + opts.limit)
  const names = await labels(c, page)
  return {
    total,
    rows: page.map(p => {
      const meta = names.get(`${p.resourceType}:${p.resourceId}`)
      const def = DRAFT_RESOURCES[p.resourceType]
      return {
        ...p,
        label: meta?.label ?? def.label,
        editHref: def.editHref(p.resourceId, meta?.ref),
        updatedAt: p.updatedAt ?? p.lock?.lastActiveAt ?? null,
      }
    }),
  }
}

/**
 * Housekeeping (cron, every few minutes): stale presence, locks of inactive admins, locks whose
 * draft is gone, and tombstones older than a week.
 */
export async function sweep(c: SqlClient): Promise<{ presence: number; released: number; orphaned: number; purged: number }> {
  const presence = await q(c, `DELETE FROM draft_presence WHERE seen_at < now() - make_interval(secs => $1)`, [PRESENCE_TTL_SECONDS])
  const released = await q(c, 
    `UPDATE draft_locks l SET previous_owner_admin_id = l.owner_admin_id, owner_admin_id = NULL, epoch = l.epoch + 1, updated_at = now()
      WHERE l.closed_at IS NULL AND l.owner_admin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.id = l.owner_admin_id AND a.is_active IS TRUE)
      RETURNING l.resource_type, l.resource_id, l.previous_owner_admin_id`
  )
  for (const row of released.rows) {
    await q(c, 
      `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'superseded'
        WHERE resource_type = $1 AND resource_id = $2 AND admin_id = $3 AND closed_at IS NULL`,
      [row.resource_type, row.resource_id, row.previous_owner_admin_id]
    )
  }
  // A lock younger than a few minutes may belong to a draft whose create is still committing.
  const open = await q(c, 
    `SELECT resource_type, resource_id FROM draft_locks WHERE closed_at IS NULL AND started_at < now() - interval '10 minutes'`
  )
  let orphaned = 0
  for (const row of open.rows) {
    const def = DRAFT_RESOURCES[row.resource_type as DraftResourceType]
    if (!def) continue
    const ex = await q(c, def.existsSql, def.existsSql.includes('$1') ? [row.resource_id] : [])
    if (ex.rows.length) continue
    const r = await q(c, 
      `UPDATE draft_locks SET closed_at = now(), closed_reason = 'orphaned', epoch = epoch + 1, updated_at = now()
        WHERE resource_type = $1 AND resource_id = $2 AND closed_at IS NULL`,
      [row.resource_type, row.resource_id]
    )
    orphaned += r.rowCount ?? 0
  }
  const purged = await q(c, `DELETE FROM draft_locks WHERE closed_at < now() - interval '7 days'`)
  return { presence: presence.rowCount ?? 0, released: released.rowCount ?? 0, orphaned, purged: purged.rowCount ?? 0 }
}
