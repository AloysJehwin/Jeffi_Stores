import { DRAFT_RESOURCES, isLockOverrideRole, type DraftResourceType } from './registry'

/** Anything with pg's query(): a pool, a PoolClient inside a transaction, or a test double. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>
}

/** Query with a normalised result, so a stubbed client that returns nothing reads as no rows. */
export async function q(c: SqlClient, text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
  const r = await c.query(text, params)
  return { rows: Array.isArray(r?.rows) ? r.rows : [], rowCount: r?.rowCount ?? 0 }
}

export type HasScopeFn = (role: string, scopes: string[], scope: string) => boolean
/** Fallback when the caller does not pass its own hasScope (legacy parents etc. live there). */
export const defaultHasScope: HasScopeFn = (role, scopes, scope) => role === 'administrator' || scopes.includes(scope)

export interface LockActor {
  adminId: string
  role?: string
  scopes?: string[]
}

export type AcquiredVia = 'start' | 'claim' | 'handover' | 'takeover' | 'backfill'
export type ClosedReason = 'published' | 'discarded' | 'finalized' | 'sent' | 'converted' | 'deleted' | 'orphaned'
export type LockChange = 'acquired' | 'released' | 'handover' | 'takeover' | 'closed'

export interface DraftLock {
  resourceType: DraftResourceType
  resourceId: string
  ownerId: string | null
  ownerName: string | null
  ownerActive: boolean
  ownerCanEdit: boolean
  startedById: string | null
  previousOwnerId: string | null
  previousOwnerName: string | null
  via: AcquiredVia
  reason: string | null
  epoch: number
  startedAt: string
  acquiredAt: string
  lastActiveAt: string
  updatedAt: string
  closedAt: string | null
  closedReason: ClosedReason | null
  closedById: string | null
  closedByName: string | null
}

export interface LockResult {
  lock: DraftLock | null
  change: LockChange | null
  /** The admin who lost the lock (handover/takeover/release), for notifications. */
  previousOwnerId?: string | null
  /** True when this call started a new draft lock rather than touching one the caller held. */
  created?: boolean
}

export interface LockOpts {
  hasScope?: HasScopeFn
}

export class DraftLockError extends Error {
  readonly status = 423
  readonly name = 'DraftLockError'
  constructor(
    readonly code: 'DRAFT_LOCKED' | 'DRAFT_LOCK_STALE',
    readonly lock: DraftLock | null,
    message?: string
  ) {
    super(
      message ??
        (code === 'DRAFT_LOCK_STALE'
          ? 'This draft changed hands. Reload to continue.'
          : `${lock?.ownerName ?? 'Another admin'} is editing this draft`)
    )
  }

  /** The 423 body every surface returns. */
  body() {
    const l = this.lock
    return {
      error: this.message,
      code: this.code,
      lock: l && {
        ownerId: l.ownerId,
        ownerName: l.ownerName,
        since: l.acquiredAt,
        startedAt: l.startedAt,
        lastActiveAt: l.lastActiveAt,
        via: l.via,
        epoch: l.epoch,
        closedAt: l.closedAt,
        closedReason: l.closedReason,
      },
    }
  }
}

/** Duck-typed so a second copy of this module (another bundle) still matches. */
export function isDraftLockError(e: unknown): e is DraftLockError {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'DraftLockError'
}

const NAME = (u: string) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${u}.first_name, ${u}.last_name)), ''), ${u}.email)`

const LOCK_SELECT = `
  SELECT l.*, ${NAME('ou')} AS owner_name, COALESCE(oa.is_active, false) AS owner_active,
         oa.role AS owner_role, oa.scopes AS owner_scopes,
         ${NAME('pu')} AS previous_owner_name, ${NAME('cu')} AS closed_by_name
    FROM draft_locks l
    LEFT JOIN admins oa ON oa.id = l.owner_admin_id LEFT JOIN users ou ON ou.id = oa.user_id
    LEFT JOIN admins pa ON pa.id = l.previous_owner_admin_id LEFT JOIN users pu ON pu.id = pa.user_id
    LEFT JOIN admins ca ON ca.id = l.closed_by_admin_id LEFT JOIN users cu ON cu.id = ca.user_id`

type Row = Record<string, any>

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v))
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v))
const scopesOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

function canEdit(row: Row, hasScope: HasScopeFn): boolean {
  if (!row.owner_admin_id || !row.owner_active) return false
  const def = DRAFT_RESOURCES[row.resource_type as DraftResourceType]
  return !!def && hasScope(String(row.owner_role ?? ''), scopesOf(row.owner_scopes), def.writeScope)
}

export function toLock(row: Row, hasScope: HasScopeFn = defaultHasScope): DraftLock {
  return {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ownerId: row.owner_admin_id ?? null,
    ownerName: row.owner_name ?? null,
    ownerActive: !!row.owner_active,
    ownerCanEdit: canEdit(row, hasScope),
    startedById: row.started_by_admin_id ?? null,
    previousOwnerId: row.previous_owner_admin_id ?? null,
    previousOwnerName: row.previous_owner_name ?? null,
    via: row.acquired_via,
    reason: row.takeover_reason ?? null,
    epoch: Number(row.epoch) || 0,
    startedAt: iso(row.started_at),
    acquiredAt: iso(row.acquired_at),
    lastActiveAt: iso(row.last_active_at),
    updatedAt: iso(row.updated_at),
    closedAt: isoOrNull(row.closed_at),
    closedReason: row.closed_reason ?? null,
    closedById: row.closed_by_admin_id ?? null,
    closedByName: row.closed_by_name ?? null,
  }
}

async function readRow(c: SqlClient, type: DraftResourceType, id: string, forUpdate = false): Promise<Row | null> {
  const r = await q(c, `${LOCK_SELECT} WHERE l.resource_type = $1 AND l.resource_id = $2${forUpdate ? ' FOR UPDATE OF l' : ''}`, [
    type,
    id,
  ])
  const row = r.rows[0]
  return row?.resource_type ? row : null
}

export async function getLock(c: SqlClient, type: DraftResourceType, id: string, opts: LockOpts = {}): Promise<DraftLock | null> {
  const row = await readRow(c, type, id)
  return row ? toLock(row, opts.hasScope) : null
}

export async function draftExists(c: SqlClient, type: DraftResourceType, id: string): Promise<boolean> {
  const sql = DRAFT_RESOURCES[type].existsSql
  const r = await q(c, sql, sql.includes('$1') ? [id] : [])
  return (r.rows?.length ?? 0) > 0
}

/** A holder who is active and still has the write scope keeps the lock; anyone else can be replaced. */
function ownerHolds(row: Row, hasScope: HasScopeFn): boolean {
  return canEdit(row, hasScope)
}

async function supersedeSessions(c: SqlClient, type: DraftResourceType, id: string, adminId: string | null) {
  if (!adminId) return
  await q(c, 
    `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'superseded'
      WHERE resource_type = $1 AND resource_id = $2 AND admin_id = $3 AND closed_at IS NULL`,
    [type, id, adminId]
  )
}

async function locked(c: SqlClient, type: DraftResourceType, id: string, opts: LockOpts, code: 'DRAFT_LOCKED' | 'DRAFT_LOCK_STALE') {
  const row = await readRow(c, type, id)
  return new DraftLockError(code, row ? toLock(row, opts.hasScope) : null)
}

/**
 * Take the lock to start or resume a draft. Succeeds when there is no lock, the lock is closed,
 * released, already the caller's, or held by an admin who is inactive or lost the write scope.
 * Otherwise throws DRAFT_LOCKED with the holder. Updates are fenced on the epoch read under
 * FOR UPDATE, so two admins racing for the same draft cannot both win.
 */
export async function acquire(
  c: SqlClient,
  actor: LockActor,
  type: DraftResourceType,
  id: string,
  opts: LockOpts & { via?: AcquiredVia } = {},
  attempt = 0
): Promise<LockResult> {
  const hasScope = opts.hasScope ?? defaultHasScope
  const via = opts.via ?? 'start'
  const ins = await q(c, 
    `INSERT INTO draft_locks (resource_type, resource_id, owner_admin_id, started_by_admin_id, acquired_via)
     VALUES ($1, $2, $3, $3, $4) ON CONFLICT (resource_type, resource_id) DO NOTHING RETURNING epoch`,
    [type, id, actor.adminId, via]
  )
  if (ins.rows[0]) return { lock: await getLock(c, type, id, opts), change: 'acquired', created: true }

  const cur = await readRow(c, type, id, true)
  if (!cur) {
    if (attempt > 1) throw new DraftLockError('DRAFT_LOCK_STALE', null)
    return acquire(c, actor, type, id, opts, attempt + 1)
  }
  if (cur.closed_at) {
    const r = await q(c, 
      `UPDATE draft_locks SET owner_admin_id = $3, started_by_admin_id = $3, previous_owner_admin_id = NULL,
              acquired_via = $4, takeover_reason = NULL, epoch = epoch + 1, started_at = now(), acquired_at = now(),
              last_active_at = now(), updated_at = now(), closed_at = NULL, closed_reason = NULL, closed_by_admin_id = NULL
        WHERE resource_type = $1 AND resource_id = $2 AND epoch = $5`,
      [type, id, actor.adminId, via, cur.epoch]
    )
    if (!r.rowCount) throw await locked(c, type, id, opts, 'DRAFT_LOCK_STALE')
    return { lock: await getLock(c, type, id, opts), change: 'acquired', created: true }
  }
  if (cur.owner_admin_id === actor.adminId) {
    await q(c, `UPDATE draft_locks SET last_active_at = now() WHERE resource_type = $1 AND resource_id = $2`, [type, id])
    return { lock: toLock(cur, hasScope), change: null, created: false }
  }
  if (ownerHolds(cur, hasScope)) throw new DraftLockError('DRAFT_LOCKED', toLock(cur, hasScope))
  const r = await q(c, 
    `UPDATE draft_locks SET owner_admin_id = $3, previous_owner_admin_id = owner_admin_id, acquired_via = 'claim',
            takeover_reason = NULL, epoch = epoch + 1, acquired_at = now(), last_active_at = now(), updated_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND epoch = $4`,
    [type, id, actor.adminId, cur.epoch]
  )
  if (!r.rowCount) throw await locked(c, type, id, opts, 'DRAFT_LOCK_STALE')
  await supersedeSessions(c, type, id, cur.owner_admin_id)
  return { lock: await getLock(c, type, id, opts), change: 'acquired', previousOwnerId: cur.owner_admin_id, created: false }
}

/**
 * Guard a draft write. Call inside the transaction that writes the draft: the UPDATE row lock is
 * held until commit, so a takeover waits for an in-flight save. A draft nobody has locked yet is
 * claimed by the first writer; with no draft at all there is nothing to guard (lock: null).
 * `epoch` (from the tab) fences a tab that still thinks it holds an older lock.
 */
export async function assertHolder(
  c: SqlClient,
  actor: LockActor,
  type: DraftResourceType,
  id: string,
  opts: LockOpts & { epoch?: number | null } = {}
): Promise<LockResult> {
  const hasScope = opts.hasScope ?? defaultHasScope
  const epoch = opts.epoch ?? null
  const hit = await q(c, 
    `UPDATE draft_locks SET last_active_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND owner_admin_id = $3 AND closed_at IS NULL
        AND ($4::int IS NULL OR epoch = $4) RETURNING epoch`,
    [type, id, actor.adminId, epoch]
  )
  if (hit.rows[0]) return { lock: null, change: null }

  const cur = await readRow(c, type, id, true)
  if (!cur || cur.closed_at) {
    if (!(await draftExists(c, type, id))) return { lock: null, change: null }
    return acquire(c, actor, type, id, { ...opts, via: cur ? 'start' : 'claim' })
  }
  if (cur.owner_admin_id === actor.adminId) throw new DraftLockError('DRAFT_LOCK_STALE', toLock(cur, hasScope))
  if (!ownerHolds(cur, hasScope)) {
    if (epoch != null) throw new DraftLockError('DRAFT_LOCK_STALE', toLock(cur, hasScope))
    return acquire(c, actor, type, id, { ...opts, via: 'claim' })
  }
  throw new DraftLockError('DRAFT_LOCKED', toLock(cur, hasScope))
}

/**
 * End the lock (publish / discard / finalize / send / convert). Keeps a tombstone so viewers can
 * read who closed it, and closes every open editor session on the resource.
 */
export async function close(
  c: SqlClient,
  actor: LockActor | null,
  type: DraftResourceType,
  id: string,
  reason: ClosedReason,
  opts: LockOpts = {}
): Promise<LockResult> {
  const by = actor?.adminId ?? null
  const upd = await q(c, 
    `UPDATE draft_locks SET closed_at = now(), closed_reason = $3, closed_by_admin_id = $4, epoch = epoch + 1,
            last_active_at = now(), updated_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND closed_at IS NULL RETURNING epoch`,
    [type, id, reason, by]
  )
  if (!upd.rowCount && by) {
    await q(c, 
      `INSERT INTO draft_locks (resource_type, resource_id, owner_admin_id, started_by_admin_id, acquired_via,
                                closed_at, closed_reason, closed_by_admin_id)
       VALUES ($1, $2, $3, $3, 'start', now(), $4, $3)
       ON CONFLICT (resource_type, resource_id) DO UPDATE
         SET closed_at = now(), closed_reason = EXCLUDED.closed_reason, closed_by_admin_id = EXCLUDED.closed_by_admin_id,
             updated_at = now()`,
      [type, id, by, reason]
    )
  }
  await q(c, 
    `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'save'
      WHERE resource_type = $1 AND resource_id = $2 AND closed_at IS NULL`,
    [type, id]
  )
  return { lock: await getLock(c, type, id, opts), change: 'closed' }
}

async function holderRow(c: SqlClient, actor: LockActor, type: DraftResourceType, id: string, opts: LockOpts): Promise<Row> {
  const cur = await readRow(c, type, id, true)
  if (!cur || cur.closed_at || cur.owner_admin_id !== actor.adminId) {
    throw new DraftLockError('DRAFT_LOCKED', cur ? toLock(cur, opts.hasScope) : null, 'You do not hold this draft')
  }
  return cur
}

export async function release(c: SqlClient, actor: LockActor, type: DraftResourceType, id: string, opts: LockOpts = {}): Promise<LockResult> {
  const cur = await holderRow(c, actor, type, id, opts)
  await q(c, 
    `UPDATE draft_locks SET owner_admin_id = NULL, previous_owner_admin_id = $3, epoch = epoch + 1, updated_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND epoch = $4`,
    [type, id, actor.adminId, cur.epoch]
  )
  await supersedeSessions(c, type, id, actor.adminId)
  return { lock: await getLock(c, type, id, opts), change: 'released', previousOwnerId: actor.adminId }
}

/** Owner passes the draft to `toAdminId` (caller checks the target is active and has the write scope). */
export async function handover(
  c: SqlClient,
  actor: LockActor,
  type: DraftResourceType,
  id: string,
  toAdminId: string,
  opts: LockOpts = {}
): Promise<LockResult> {
  const cur = await holderRow(c, actor, type, id, opts)
  await q(c, 
    `UPDATE draft_locks SET owner_admin_id = $3, previous_owner_admin_id = $4, acquired_via = 'handover',
            takeover_reason = NULL, epoch = epoch + 1, acquired_at = now(), last_active_at = now(), updated_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND epoch = $5`,
    [type, id, toAdminId, actor.adminId, cur.epoch]
  )
  await supersedeSessions(c, type, id, actor.adminId)
  return { lock: await getLock(c, type, id, opts), change: 'handover', previousOwnerId: actor.adminId }
}

/** Owner-role force takeover with a reason. Waits on the row lock, so an in-flight save finishes first. */
export async function takeover(
  c: SqlClient,
  actor: LockActor,
  type: DraftResourceType,
  id: string,
  reason: string,
  opts: LockOpts = {}
): Promise<LockResult> {
  if (!isLockOverrideRole(actor.role)) throw new DraftLockError('DRAFT_LOCKED', await getLock(c, type, id, opts), 'Only owners can take over a draft')
  const cur = await readRow(c, type, id, true)
  if (!cur || cur.closed_at || !cur.owner_admin_id) return acquire(c, actor, type, id, { ...opts, via: 'claim' })
  if (cur.owner_admin_id === actor.adminId) return { lock: toLock(cur, opts.hasScope), change: null }
  await q(c, 
    `UPDATE draft_locks SET owner_admin_id = $3, previous_owner_admin_id = owner_admin_id, acquired_via = 'takeover',
            takeover_reason = $4, epoch = epoch + 1, acquired_at = now(), last_active_at = now(), updated_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND epoch = $5`,
    [type, id, actor.adminId, reason, cur.epoch]
  )
  await supersedeSessions(c, type, id, cur.owner_admin_id)
  return { lock: await getLock(c, type, id, opts), change: 'takeover', previousOwnerId: cur.owner_admin_id }
}

export interface DraftLockStatus {
  lock: DraftLock | null
  draftExists: boolean
  ownerHintId: string | null
}

/**
 * Lock + whether a draft exists. A draft with no lock row is unclaimed; if the type has a strong
 * owner hint (po_drafts.admin_id, quotations.created_by, …) and that admin can still edit, the
 * first read seeds the lock with them.
 */
export async function status(c: SqlClient, type: DraftResourceType, id: string, opts: LockOpts = {}): Promise<DraftLockStatus> {
  const hasScope = opts.hasScope ?? defaultHasScope
  let row = await readRow(c, type, id)
  const exists = await draftExists(c, type, id)
  let hint: string | null = null
  const def = DRAFT_RESOURCES[type]
  if (def.hintSql && exists && (!row || row.closed_at)) {
    const h = await q(c, def.hintSql, def.hintSql.includes('$1') ? [id] : [])
    hint = h.rows[0]?.admin_id ?? null
    if (hint && !row) {
      const a = await q(c, `SELECT role, scopes, is_active FROM admins WHERE id = $1`, [hint])
      const adm = a.rows[0]
      if (adm?.is_active && hasScope(String(adm.role ?? ''), scopesOf(adm.scopes), def.writeScope)) {
        await q(c, 
          `INSERT INTO draft_locks (resource_type, resource_id, owner_admin_id, started_by_admin_id, acquired_via)
           VALUES ($1, $2, $3, $3, 'backfill') ON CONFLICT (resource_type, resource_id) DO NOTHING`,
          [type, id, hint]
        )
        row = await readRow(c, type, id)
      }
    }
  }
  return { lock: row ? toLock(row, hasScope) : null, draftExists: exists, ownerHintId: hint }
}

/** Open locks for a list page's rows, keyed by resource id. */
export async function lockMap(c: SqlClient, type: DraftResourceType, ids: string[], opts: LockOpts = {}): Promise<Record<string, DraftLock>> {
  if (!ids.length) return {}
  const r = await q(c, `${LOCK_SELECT} WHERE l.resource_type = $1 AND l.resource_id = ANY($2::uuid[]) AND l.closed_at IS NULL`, [type, ids])
  const out: Record<string, DraftLock> = {}
  for (const row of r.rows) out[row.resource_id] = toLock(row, opts.hasScope)
  return out
}

/**
 * Locks changed after `cursor` (the SSE poll, so changes still arrive without Redis, across
 * instances, and from document-service). Returns the new cursor.
 */
export async function changedSince(
  c: SqlClient,
  cursor: string | null,
  opts: LockOpts & { limit?: number } = {}
): Promise<{ locks: DraftLock[]; cursor: string }> {
  if (!cursor) {
    const r = await q(c, `SELECT now()::text AS now`)
    return { locks: [], cursor: String(r.rows[0]?.now ?? new Date().toISOString()) }
  }
  // Text cursor keeps microseconds; a millisecond ISO cursor would re-send the last row forever.
  const r = await q(c, 
    `SELECT * FROM (${LOCK_SELECT}) x, LATERAL (SELECT x.updated_at::text AS cursor_text) ct
      WHERE x.updated_at > $1::timestamptz ORDER BY x.updated_at LIMIT $2`,
    [cursor, opts.limit ?? 100]
  )
  const locks = r.rows.map(row => toLock(row, opts.hasScope))
  return { locks, cursor: r.rows.length ? String(r.rows[r.rows.length - 1].cursor_text) : cursor }
}

/** Release every lock an admin holds (deactivated, deleted, or scopes changed). */
export async function releaseLocksOfAdmin(c: SqlClient, adminId: string): Promise<{ resourceType: DraftResourceType; resourceId: string }[]> {
  const r = await q(c, 
    `UPDATE draft_locks SET previous_owner_admin_id = owner_admin_id, owner_admin_id = NULL, epoch = epoch + 1, updated_at = now()
      WHERE owner_admin_id = $1 AND closed_at IS NULL RETURNING resource_type, resource_id`,
    [adminId]
  )
  for (const row of r.rows) await supersedeSessions(c, row.resource_type, row.resource_id, adminId)
  return r.rows.map(row => ({ resourceType: row.resource_type, resourceId: row.resource_id }))
}

/** The entity itself is gone: drop its lock and presence rows. */
export async function dropLocksFor(c: SqlClient, type: DraftResourceType, id: string): Promise<void> {
  await q(c, `DELETE FROM draft_locks WHERE resource_type = $1 AND resource_id = $2`, [type, id])
  await q(c, `DELETE FROM draft_presence WHERE resource_type = $1 AND resource_id = $2`, [type, id])
}
