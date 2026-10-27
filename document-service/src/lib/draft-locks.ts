// Draft locks for invoice / quotation / purchase-order drafts. Same rules as the controller
// (packages/draft-locks); the actor comes from the service token, audit + notifications go in by
// direct SQL, and the controller's SSE poll on draft_locks.updated_at relays the changes.
import type pg from 'pg'
import * as dl from '@jeffi/draft-locks'
import type { DraftResourceType, LockResult } from '@jeffi/draft-locks'
import { query, withTransaction } from '@jeffi/tenancy'
import { NextResponse, type NextRequest } from '../next'
import { hasScope } from './scopes'

export { isDraftLockError } from '@jeffi/draft-locks'

export type DocActor = { adminId: string; role?: string; scopes?: string[] } | null | undefined

const OPTS = { hasScope: (role: string, scopes: string[], scope: string) => hasScope(role, scopes, scope) }
const pool: dl.SqlClient = { query: (t, p) => query(t, p as any[]) }

export function epochFrom(req: NextRequest): number | null {
  return dl.parseEpoch(req.headers.get(dl.DRAFT_LOCK_EPOCH_HEADER))
}

export function draftLockResponse(err: unknown): NextResponse | null {
  if (!dl.isDraftLockError(err)) return null
  return NextResponse.json(err.body(), { status: 423 })
}

async function audit(adminId: string, action: string, type: DraftResourceType, id: string, summary: string, metadata: Record<string, unknown> = {}) {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, summary, metadata)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [adminId, action, type, id, summary, JSON.stringify(metadata)]
    )
  } catch {
    /* best effort */
  }
}

async function logChange(actor: NonNullable<DocActor>, type: DraftResourceType, id: string, res: LockResult | null | undefined) {
  if (res?.change === 'acquired') {
    await audit(actor.adminId, 'lock', type, id, `Started editing ${dl.DRAFT_RESOURCES[type].label.toLowerCase()} draft`, {
      via: res.lock?.via,
      epoch: res.lock?.epoch,
    })
  }
}

/** Audit a lock taken on the handler's own client, once its transaction committed. */
export async function announceLock(actor: DocActor, type: DraftResourceType, id: string, res: LockResult | null | undefined) {
  if (actor?.adminId) await logChange(actor, type, id, res)
}

/**
 * Assert the lock inside the handler's own transaction (no actor = pass-through). Calling it after
 * the draft write, before commit, is just as safe: a refusal rolls the write back.
 */
export async function assertHolder(client: dl.SqlClient, actor: DocActor, type: DraftResourceType, id: string, opts: { epoch?: number | null } = {}) {
  if (!actor?.adminId) return null
  return dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
}

/**
 * A draft write in a transaction that asserts the caller holds the lock after the write (a
 * refusal rolls it back). `close`: end the lock in the same transaction (publish / finalize).
 */
export async function withDraftWrite<T>(
  actor: DocActor,
  type: DraftResourceType,
  id: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: { epoch?: number | null; close?: dl.ClosedReason } = {}
): Promise<T> {
  if (!actor?.adminId) return withTransaction(fn)
  let res: LockResult | null = null
  const out = await withTransaction(async client => {
    const value = await fn(client)
    res = await dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
    if (opts.close) await dl.close(client, actor, type, id, opts.close, OPTS)
    return value
  })
  await logChange(actor, type, id, res)
  return out
}

/** Start a draft. With `client` it runs in the creating transaction; call announceLock after commit. */
export async function acquireLock(client: dl.SqlClient | null, actor: DocActor, type: DraftResourceType, id: string): Promise<LockResult | null> {
  if (!actor?.adminId) return null
  if (client) return dl.acquire(client, actor, type, id, OPTS)
  const res = await withTransaction(c => dl.acquire(c, actor, type, id, OPTS))
  await logChange(actor, type, id, res)
  return res
}

/** Lock a draft the caller just created outside a transaction (best effort: the first writer claims it). */
export async function lockNewDraft(actor: DocActor, type: DraftResourceType, id: string): Promise<void> {
  try {
    await acquireLock(null, actor, type, id)
  } catch (err) {
    console.error('[draft-locks] lock of new draft failed for', type, id, err)
  }
}

/** Non-transactional check for actions that do not write the draft (resend): 423 body or null. */
export async function lockedByOther(actor: DocActor, type: DraftResourceType, id: string): Promise<NextResponse | null> {
  if (!actor?.adminId) return null
  try {
    const lock = await dl.getLock(pool, type, id, OPTS)
    if (lock && !lock.closedAt && lock.ownerId && lock.ownerId !== actor.adminId && lock.ownerCanEdit) {
      return NextResponse.json(new dl.DraftLockError('DRAFT_LOCKED', lock).body(), { status: 423 })
    }
  } catch {
    /* lock store unavailable: do not block */
  }
  return null
}

export interface LockBadge {
  ownerId: string
  ownerName: string | null
  lastActiveAt: string
  mine: boolean
}

/** Who holds each listed draft (for the list's owner badge). Never throws. */
export async function lockBadges(actor: DocActor, type: DraftResourceType, ids: string[]): Promise<Record<string, LockBadge>> {
  const out: Record<string, LockBadge> = {}
  if (!ids.length) return out
  try {
    const map = await dl.lockMap(pool, type, ids, OPTS)
    for (const [id, l] of Object.entries(map)) {
      if (l.ownerId) out[id] = { ownerId: l.ownerId, ownerName: l.ownerName, lastActiveAt: l.lastActiveAt, mine: l.ownerId === actor?.adminId }
    }
  } catch {
    /* badges are cosmetic */
  }
  return out
}

export async function closeLock(client: dl.SqlClient | null, actor: DocActor, type: DraftResourceType, id: string, reason: dl.ClosedReason) {
  const run = (c: dl.SqlClient) => dl.close(c, actor?.adminId ? actor : null, type, id, reason, OPTS)
  return client ? run(client) : withTransaction(run)
}

/** Close after a discard / delete that already happened (never fails the caller). */
export async function closeAfter(actor: DocActor, type: DraftResourceType, id: string, reason: dl.ClosedReason): Promise<void> {
  if (!actor?.adminId) return
  try {
    await closeLock(null, actor, type, id, reason)
  } catch (err) {
    console.error('[draft-locks] close failed for', type, id, err)
  }
}

export async function getLock(type: DraftResourceType, id: string) {
  return dl.getLock(pool, type, id, OPTS)
}

/** Holder, an unclaimed draft, or an owner role (audited as discard_override, holder notified). */
export async function canDiscard(actor: DocActor, type: DraftResourceType, id: string, client?: dl.SqlClient): Promise<dl.DraftLockError | null> {
  if (!actor?.adminId) return null
  const lock = await dl.getLock(client ?? pool, type, id, OPTS)
  if (!lock || lock.closedAt || !lock.ownerId || lock.ownerId === actor.adminId || !lock.ownerCanEdit) return null
  if (!dl.isLockOverrideRole(actor.role)) return new dl.DraftLockError('DRAFT_LOCKED', lock)
  const label = dl.DRAFT_RESOURCES[type].label.toLowerCase()
  await audit(actor.adminId, 'discard_override', type, id, `Discarded ${lock.ownerName ?? 'another admin'}'s ${label} draft`, { ownerId: lock.ownerId })
  try {
    await query(
      `INSERT INTO admin_notifications (type, category, title, message, entity_type, entity_id, severity, recipient_admin_id)
       VALUES ('draft_discarded', 'drafts', $1, 'An owner discarded a draft you were editing.', $2, $3, 'warning', $4)`,
      [`Your ${label} draft was discarded`, type, id, lock.ownerId]
    )
  } catch {
    /* best effort */
  }
  return null
}
