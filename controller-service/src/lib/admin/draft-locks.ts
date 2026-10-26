import type { PoolClient } from 'pg'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import * as dl from '@jeffi/draft-locks'
import type { DraftLock, DraftResourceType, LockResult } from '@jeffi/draft-locks'
import { query, withTransaction } from '@/lib/shared/db'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { getHost } from '@/lib/tenancy/get-host'
import { ap } from '@/lib/shared/admin-path'
import { getRedisClient } from '@/lib/shared/redis'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { publishLockEvent, type LockEventType } from './draft-lock-events'

export { HOMEPAGE_LOCK_ID, DRAFT_RESOURCES, isDraftResourceType, isDraftLockError } from '@jeffi/draft-locks'
export type { DraftLock, DraftResourceType } from '@jeffi/draft-locks'

/** Who is writing. No actor = system writer (imports, crons, variant-status): never locked. */
export type DraftActor = { adminId: string; role?: string; scopes?: string[] } | null | undefined

const OPTS = { hasScope }
const pool: dl.SqlClient = { query: (text, params) => query(text, params as any[]) }

export function epochFrom(req: { headers: { get(name: string): string | null } } | null | undefined): number | null {
  return dl.parseEpoch(req?.headers.get(dl.DRAFT_LOCK_EPOCH_HEADER))
}

/** 423 body for a lock error, or null for anything else (let the caller handle it). */
export function draftLockResponse(err: unknown): NextResponse | null {
  if (!dl.isDraftLockError(err)) return null
  return NextResponse.json(err.body(), { status: 423 })
}

const EVENT_FOR: Record<NonNullable<LockResult['change']>, LockEventType> = {
  acquired: 'acquired',
  released: 'released',
  handover: 'handover',
  takeover: 'takeover',
  closed: 'closed',
}

function entityLabel(type: DraftResourceType) {
  return dl.DRAFT_RESOURCES[type].label.toLowerCase()
}

async function editLink(type: DraftResourceType, id: string): Promise<string> {
  let ref: string | null = null
  try {
    const sql = dl.DRAFT_RESOURCES[type].labelSql
    const r = await query(sql, sql.includes('$1') ? [[id]] : [])
    ref = r.rows[0]?.ref ?? null
  } catch {
    /* link without ref */
  }
  return dl.DRAFT_RESOURCES[type].editHref(id, ref)
}

/** Publish + audit a lock change after its transaction committed. Never throws. */
async function announce(actor: NonNullable<DraftActor>, type: DraftResourceType, id: string, res: LockResult, reason?: string | null) {
  if (!res.change) return
  try {
    await publishLockEvent({ type: EVENT_FOR[res.change], resourceType: type, resourceId: id, lock: res.lock, by: actor.adminId, reason })
    if (res.change === 'acquired') {
      await logAdminAudit({
        adminId: actor.adminId,
        action: 'lock',
        entityType: type,
        entityId: id,
        summary: `Started editing ${entityLabel(type)} draft`,
        metadata: { via: res.lock?.via, epoch: res.lock?.epoch, previousOwnerId: res.previousOwnerId ?? null },
      })
    }
  } catch {
    /* best effort */
  }
}

/**
 * Run a draft write inside a transaction that first asserts the caller holds the lock. The lock
 * row stays locked until commit, so a takeover waits for this save. Throws DraftLockError (→ 423
 * via draftLockResponse). No actor = pass-through.
 */
export async function withDraftWrite<T>(
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  fn: (client: PoolClient) => Promise<T>,
  opts: { epoch?: number | null } = {}
): Promise<T> {
  if (!actor?.adminId) return withTransaction(fn)
  let res: LockResult | null = null
  const out = await withTransaction(async client => {
    res = await dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
    return fn(client)
  })
  if (res) await announce(actor, type, id, res)
  return out
}

/** Assert inside a transaction the caller already runs (no-op without an actor). */
export async function assertDraftHolder(
  client: dl.SqlClient,
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  opts: { epoch?: number | null } = {}
): Promise<LockResult | null> {
  if (!actor?.adminId) return null
  return dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
}

/**
 * Start (or resume) a draft. `created: false` with the caller as holder means the draft was
 * already theirs (routes keep answering 409 there). Throws DraftLockError if someone else holds it.
 */
export async function acquireDraftLock(
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  client?: dl.SqlClient
): Promise<LockResult | null> {
  if (!actor?.adminId) return null
  const res = client ? await dl.acquire(client, actor, type, id, OPTS) : await withTransaction(c => dl.acquire(c, actor, type, id, OPTS))
  if (!client) await announce(actor, type, id, res)
  return res
}

/** Call after the caller's own transaction committed, when acquire/close ran on its client. */
export async function announceDraftLock(actor: DraftActor, type: DraftResourceType, id: string, res: LockResult | null | undefined) {
  if (actor?.adminId && res) await announce(actor, type, id, res)
}

/** Close the lock (published / discarded / …). Inside the caller's transaction when `client` is given. */
export async function closeDraftLock(
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  reason: dl.ClosedReason,
  client?: dl.SqlClient
): Promise<LockResult | null> {
  const run = (c: dl.SqlClient) => dl.close(c, actor?.adminId ? actor : null, type, id, reason, OPTS)
  const res = client ? await run(client) : await withTransaction(run)
  if (!client) await publishLockEvent({ type: 'closed', resourceType: type, resourceId: id, lock: res.lock, by: actor?.adminId ?? null, reason })
  return res
}

/** Event for a close that ran on the caller's client, sent once its transaction committed. */
export async function announceDraftClosed(actor: DraftActor, type: DraftResourceType, id: string, res: LockResult | null | undefined, reason?: string) {
  if (!res) return
  await publishLockEvent({ type: 'closed', resourceType: type, resourceId: id, lock: res.lock, by: actor?.adminId ?? null, reason })
}

/**
 * Discard: the holder, or an owner role (audited as discard_override, holder notified).
 * Unclaimed drafts can be discarded by anyone with the write scope.
 */
export async function canDiscard(
  actor: DraftActor,
  type: DraftResourceType,
  id: string
): Promise<{ ok: true; override: boolean } | { ok: false; error: dl.DraftLockError }> {
  if (!actor?.adminId) return { ok: true, override: false }
  const lock = await dl.getLock(pool, type, id, OPTS)
  if (!lock || lock.closedAt || !lock.ownerId || lock.ownerId === actor.adminId || !lock.ownerCanEdit) return { ok: true, override: false }
  if (actor.role && isPlatformOwner(actor.role)) {
    await logAdminAudit({
      adminId: actor.adminId,
      action: 'discard_override',
      entityType: type,
      entityId: id,
      summary: `Discarded ${lock.ownerName ?? 'another admin'}'s ${entityLabel(type)} draft`,
      metadata: { ownerId: lock.ownerId },
    })
    await createAdminNotification({
      type: 'draft_discarded',
      category: 'drafts',
      title: `Your ${entityLabel(type)} draft was discarded`,
      message: 'An owner discarded a draft you were editing.',
      entityType: type,
      entityId: id,
      severity: 'warning',
      recipientAdminId: lock.ownerId,
    })
    return { ok: true, override: true }
  }
  return { ok: false, error: new dl.DraftLockError('DRAFT_LOCKED', lock) }
}

export interface DraftLockState {
  lock: DraftLock | null
  draftExists: boolean
  isMine: boolean
  canEdit: boolean
  canTakeOver: boolean
  canDiscard: boolean
}

/** What the viewer may do with this draft right now (pages + the lock API). */
export async function getDraftLockState(
  viewer: { adminId: string; role: string; scopes: string[] },
  type: DraftResourceType,
  id: string
): Promise<DraftLockState> {
  const st = await dl.status(pool, type, id, OPTS)
  const lock = st.lock && !st.lock.closedAt ? st.lock : null
  const writer = hasScope(viewer.role, viewer.scopes, dl.DRAFT_RESOURCES[type].writeScope)
  const isMine = !!lock && lock.ownerId === viewer.adminId
  const free = !lock || !lock.ownerId || !lock.ownerCanEdit
  const owner = isPlatformOwner(viewer.role)
  return {
    lock: st.lock,
    draftExists: st.draftExists,
    isMine,
    canEdit: writer && (isMine || free),
    canTakeOver: writer && owner && !!lock && !!lock.ownerId && !isMine,
    canDiscard: writer && (isMine || free || owner),
  }
}

/** Server-action guard: assert the lock or bounce back to the edit page in read-only mode. */
export async function lockOrRedirect(type: DraftResourceType, id: string, editPath: string): Promise<void> {
  const session = await getAdminSession()
  if (!session?.adminId) return
  try {
    const res = await withTransaction(c => dl.assertHolder(c, session, type, id, OPTS))
    await announce(session, type, id, res)
  } catch (err) {
    if (!dl.isDraftLockError(err)) throw err
    redirect(ap(`${editPath}${editPath.includes('?') ? '&' : '?'}locked=1`, await getHost()))
  }
}

/** Server-action acquire for start*Draft: returns false (caller redirects read-only) when locked. */
export async function tryAcquireForAction(type: DraftResourceType, id: string): Promise<boolean> {
  const session = await getAdminSession()
  if (!session?.adminId) return true
  try {
    await acquireDraftLock(session, type, id)
    return true
  } catch (err) {
    if (dl.isDraftLockError(err)) return false
    throw err
  }
}

/** The signed-in admin for server actions (null outside a request). */
export async function actionActor(): Promise<DraftActor> {
  try {
    const s = await getAdminSession()
    return s?.adminId ? { adminId: s.adminId, role: s.role, scopes: s.scopes } : null
  } catch {
    return null
  }
}

export async function getDraftLockMap(type: DraftResourceType, ids: string[]): Promise<Record<string, DraftLock>> {
  try {
    return await dl.lockMap(pool, type, ids, OPTS)
  } catch {
    return {}
  }
}

/** Deactivated, deleted, or re-scoped admin: free their drafts for others to claim. */
export async function releaseLocksOfAdmin(adminId: string, actor?: DraftActor): Promise<number> {
  try {
    const freed = await withTransaction(c => dl.releaseLocksOfAdmin(c, adminId))
    for (const f of freed) {
      await publishLockEvent({ type: 'released', resourceType: f.resourceType, resourceId: f.resourceId, lock: null, by: actor?.adminId ?? null })
    }
    return freed.length
  } catch (err) {
    console.error('[draft-locks] releaseLocksOfAdmin failed for', adminId, err)
    return 0
  }
}

/** The entity was deleted outright. */
export async function dropDraftLocksFor(type: DraftResourceType, id: string, client?: dl.SqlClient): Promise<void> {
  try {
    await dl.dropLocksFor(client ?? pool, type, id)
  } catch (err) {
    if (client) throw err
    console.error('[draft-locks] drop failed for', type, id, err)
  }
}

export async function releaseDraftLock(actor: NonNullable<DraftActor>, type: DraftResourceType, id: string, request?: Request) {
  const res = await withTransaction(c => dl.release(c, actor, type, id, OPTS))
  await publishLockEvent({ type: 'released', resourceType: type, resourceId: id, lock: res.lock, by: actor.adminId })
  await logAdminAudit({
    adminId: actor.adminId,
    action: 'unlock',
    entityType: type,
    entityId: id,
    summary: `Released ${entityLabel(type)} draft`,
    request: request as any,
  })
  return res
}

export async function handoverDraftLock(actor: NonNullable<DraftActor>, type: DraftResourceType, id: string, toAdminId: string, request?: Request) {
  const res = await withTransaction(c => dl.handover(c, actor, type, id, toAdminId, OPTS))
  await publishLockEvent({ type: 'handover', resourceType: type, resourceId: id, lock: res.lock, by: actor.adminId })
  await logAdminAudit({
    adminId: actor.adminId,
    action: 'handover',
    entityType: type,
    entityId: id,
    summary: `Handed ${entityLabel(type)} draft to ${res.lock?.ownerName ?? 'another admin'}`,
    metadata: { toAdminId, epoch: res.lock?.epoch },
    request: request as any,
  })
  await createAdminNotification({
    type: 'draft_handover',
    category: 'drafts',
    title: `A ${entityLabel(type)} draft was handed to you`,
    message: `${res.lock?.previousOwnerName ?? 'An admin'} handed you a draft to finish.`,
    link: await editLink(type, id),
    entityType: type,
    entityId: id,
    recipientAdminId: toAdminId,
  })
  return res
}

export async function takeoverDraftLock(actor: NonNullable<DraftActor>, type: DraftResourceType, id: string, reason: string, request?: Request) {
  const res = await withTransaction(c => dl.takeover(c, actor, type, id, reason, OPTS))
  if (!res.change) return res
  await publishLockEvent({ type: res.change === 'takeover' ? 'takeover' : 'acquired', resourceType: type, resourceId: id, lock: res.lock, by: actor.adminId, reason })
  await logAdminAudit({
    adminId: actor.adminId,
    action: 'takeover',
    entityType: type,
    entityId: id,
    summary: `Took over ${entityLabel(type)} draft`,
    metadata: { reason, previousOwnerId: res.previousOwnerId ?? null, epoch: res.lock?.epoch },
    request: request as any,
  })
  if (res.previousOwnerId) {
    await createAdminNotification({
      type: 'draft_takeover',
      category: 'drafts',
      title: `${res.lock?.ownerName ?? 'An owner'} took over your ${entityLabel(type)} draft`,
      message: reason,
      link: await editLink(type, id),
      entityType: type,
      entityId: id,
      severity: 'warning',
      recipientAdminId: res.previousOwnerId,
    })
  }
  return res
}

/** Ask the holder for the draft. De-duplicated per recipient and rate-limited per requester. */
export async function requestDraftAccess(actor: NonNullable<DraftActor> & { displayName?: string }, type: DraftResourceType, id: string, message?: string, request?: Request) {
  const lock = await dl.getLock(pool, type, id, OPTS)
  if (!lock?.ownerId || lock.closedAt || lock.ownerId === actor.adminId) return { sent: false as const, reason: 'no_holder' }
  try {
    const tenant = (await resolveTenantId().catch(() => null)) || 'platform'
    const r = getRedisClient()
    const key = `dl:req:${tenant}:${actor.adminId}:${type}:${id}`
    const ok = await r.set(key, '1', 'EX', 300, 'NX')
    if (ok !== 'OK') return { sent: false as const, reason: 'rate_limited' }
  } catch {
    /* no redis: the notification dedupe still applies */
  }
  await createAdminNotification({
    type: `draft_access_request:${actor.adminId}`,
    category: 'drafts',
    title: `${actor.displayName ?? 'An admin'} asked for your ${entityLabel(type)} draft`,
    message: message?.slice(0, 500) || 'Hand it over from the draft banner when you are done.',
    link: await editLink(type, id),
    entityType: type,
    entityId: id,
    recipientAdminId: lock.ownerId,
  })
  await logAdminAudit({
    adminId: actor.adminId,
    action: 'request_access',
    entityType: type,
    entityId: id,
    summary: `Requested ${lock.ownerName ?? 'the holder'}'s ${entityLabel(type)} draft`,
    request: request as any,
  })
  return { sent: true as const }
}

/** Active admins who may receive a handover (write scope on the type), excluding the caller. */
export async function handoverCandidates(type: DraftResourceType, exceptAdminId: string) {
  const r = await query(
    `SELECT a.id, a.role, a.scopes, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name
       FROM admins a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.is_active IS TRUE AND a.id <> $1
      ORDER BY name`,
    [exceptAdminId]
  )
  const scope = dl.DRAFT_RESOURCES[type].writeScope
  return r.rows
    .filter(a => hasScope(String(a.role ?? ''), Array.isArray(a.scopes) ? a.scopes : [], scope))
    .map(a => ({ adminId: a.id as string, name: (a.name as string) ?? 'Admin' }))
}

export async function canReceiveHandover(type: DraftResourceType, adminId: string): Promise<boolean> {
  const r = await query(`SELECT role, scopes, is_active FROM admins WHERE id = $1`, [adminId])
  const a = r.rows[0]
  return !!a?.is_active && hasScope(String(a.role ?? ''), Array.isArray(a.scopes) ? a.scopes : [], dl.DRAFT_RESOURCES[type].writeScope)
}

/** Lock state for a page that renders an editor, with its 'acquire on open' semantics left to the client. */
export async function initialDraftLock(type: DraftResourceType, id: string): Promise<DraftLockState | null> {
  try {
    const s = await getAdminSession()
    if (!s?.adminId) return null
    return await getDraftLockState(s, type, id)
  } catch {
    return null
  }
}
