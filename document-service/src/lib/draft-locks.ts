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

/** Assert the lock inside the handler's own transaction (no actor = pass-through). */
export async function assertHolder(client: dl.SqlClient, actor: DocActor, type: DraftResourceType, id: string, opts: { epoch?: number | null } = {}) {
  if (!actor?.adminId) return null
  return dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
}

/** A draft write in a transaction that first asserts the caller holds the lock. */
export async function withDraftWrite<T>(
  actor: DocActor,
  type: DraftResourceType,
  id: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: { epoch?: number | null } = {}
): Promise<T> {
  if (!actor?.adminId) return withTransaction(fn)
  let res: LockResult | null = null
  const out = await withTransaction(async client => {
    res = await dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
    return fn(client)
  })
  await logChange(actor, type, id, res)
  return out
}

/** Start a draft (inside the creating transaction when `client` is given). */
export async function acquireLock(client: dl.SqlClient | null, actor: DocActor, type: DraftResourceType, id: string): Promise<LockResult | null> {
  if (!actor?.adminId) return null
  const res = client ? await dl.acquire(client, actor, type, id, OPTS) : await withTransaction(c => dl.acquire(c, actor, type, id, OPTS))
  await logChange(actor, type, id, res)
  return res
}

export async function closeLock(client: dl.SqlClient | null, actor: DocActor, type: DraftResourceType, id: string, reason: dl.ClosedReason) {
  const run = (c: dl.SqlClient) => dl.close(c, actor?.adminId ? actor : null, type, id, reason, OPTS)
  return client ? run(client) : withTransaction(run)
}

export async function getLock(type: DraftResourceType, id: string) {
  return dl.getLock(pool, type, id, OPTS)
}

/** Holder, an unclaimed draft, or an owner role (audited as discard_override, holder notified). */
export async function canDiscard(actor: DocActor, type: DraftResourceType, id: string): Promise<dl.DraftLockError | null> {
  if (!actor?.adminId) return null
  const lock = await dl.getLock(pool, type, id, OPTS)
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
