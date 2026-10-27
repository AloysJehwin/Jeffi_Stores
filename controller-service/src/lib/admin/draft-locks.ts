import type { QueryResult, QueryResultRow } from 'pg'
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
import type { DraftLockChip } from '@/lib/client/draft-lock-client'
import { publishLockEvent, type LockEventType } from './draft-lock-events'

export { HOMEPAGE_LOCK_ID, DRAFT_RESOURCES, isDraftResourceType, isDraftLockError } from '@jeffi/draft-locks'
export type { DraftLock, DraftResourceType } from '@jeffi/draft-locks'
export type { DraftLockChip } from '@/lib/client/draft-lock-client'

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

/** For `.catch(lockedOr)`: a lock error becomes its 423 response, anything else rethrows. */
export function lockedOr(err: unknown): NextResponse {
  const locked = draftLockResponse(err)
  if (locked) return locked
  throw err
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

/** A transaction client or the pool: both answer query(text, params). */
export type DraftDb = { query: <R extends QueryResultRow = any>(text: string, params?: any[]) => Promise<QueryResult<R>> }
const poolDb: DraftDb = { query: (text, params) => query(text, params) }

export const actorOf = (a: { adminId?: string; role?: string; scopes?: string[] } | null | undefined): DraftActor =>
  a?.adminId ? { adminId: a.adminId, role: a.role, scopes: a.scopes } : null

/**
 * Run a draft write inside a transaction that first asserts the caller holds the lock. The lock
 * row stays locked until commit, so a takeover waits for this save. Throws DraftLockError (→ 423
 * via draftLockResponse). No actor = pass-through: `fn` runs on the pool as before.
 * `ensure`: when the draft did not exist yet (so nothing was asserted), take the lock after the
 * write, still inside the transaction. `assertAfter`: assert after the write instead (a draft the
 * write just created is claimed then).
 */
export async function withDraftWrite<T>(
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  fn: (db: DraftDb) => Promise<T>,
  opts: { epoch?: number | null; ensure?: boolean; assertAfter?: boolean } = {}
): Promise<T> {
  if (!actor?.adminId) return fn(poolDb)
  let res: LockResult | null = null
  const assert = (c: dl.SqlClient) => dl.assertHolder(c, actor, type, id, { ...OPTS, epoch: opts.epoch })
  const out = await withTransaction(async client => {
    // assertAfter: same guarantee (a refusal rolls the write back), the write just runs first.
    if (!opts.assertAfter) res = await assert(client)
    const value = await fn(client as unknown as DraftDb)
    if (opts.assertAfter) res = await assert(client)
    else if (opts.ensure && res && !res.lock && !res.change) res = await dl.acquire(client, actor, type, id, OPTS)
    return value
  })
  if (res) await announce(actor, type, id, res)
  return out
}

/** Create a draft and take its lock in one transaction (no actor = plain write on the pool). */
export async function withDraftCreate<T>(actor: DraftActor, type: DraftResourceType, id: string, fn: (db: DraftDb) => Promise<T>): Promise<T> {
  if (!actor?.adminId) return fn(poolDb)
  let res: LockResult | null = null
  const out = await withTransaction(async client => {
    const value = await fn(client as unknown as DraftDb)
    res = await dl.acquire(client, actor, type, id, OPTS)
    return value
  })
  if (res) await announce(actor, type, id, res)
  return out
}

/** 423 when the caller may not discard / delete this draft (see canDiscard), else null. */
export async function discardGuard(actor: DraftActor, type: DraftResourceType, id: string): Promise<NextResponse | null> {
  const r = await canDiscard(actor, type, id)
  return r.ok ? null : NextResponse.json(r.error.body(), { status: 423 })
}

/** Lock a draft the caller just created (best effort: an unlocked draft is claimed by its first writer). */
export async function lockNewDraft(actor: DraftActor, type: DraftResourceType, id: string): Promise<void> {
  if (!actor?.adminId) return
  try {
    await acquireDraftLock(actor, type, id)
  } catch (err) {
    console.error('[draft-locks] lock of new draft failed for', type, id, err)
  }
}

/** Close the lock after a discard / delete that already happened (never fails the caller). */
export async function closeAfter(actor: DraftActor, type: DraftResourceType, id: string, reason: dl.ClosedReason): Promise<void> {
  if (!actor?.adminId) return
  try {
    await closeDraftLock(actor, type, id, reason)
  } catch (err) {
    console.error('[draft-locks] close failed for', type, id, err)
  }
}

/** A campaign's lock id is its campaign_drafts.campaign_id; `create` seeds the empty row first. */
export async function campaignLockId(kind: string, create = false): Promise<string | null> {
  if (create) {
    await query(`INSERT INTO campaign_drafts (kind) VALUES ($1) ON CONFLICT (kind) DO NOTHING`, [kind])
  }
  const r = await query(`SELECT campaign_id FROM campaign_drafts WHERE kind = $1`, [kind])
  return (r?.rows?.[0]?.campaign_id as string | undefined) ?? null
}

/** A live write on an entity whose draft someone else holds: 423, else null. */
export async function lockedByOther(actor: DraftActor, type: DraftResourceType, id: string): Promise<NextResponse | null> {
  if (!actor?.adminId) return null
  try {
    const lock = await dl.getLock(pool, type, id, OPTS)
    if (lock && !lock.closedAt && lock.ownerId && lock.ownerId !== actor.adminId && lock.ownerCanEdit) {
      return NextResponse.json(new dl.DraftLockError('DRAFT_LOCKED', lock).body(), { status: 423 })
    }
  } catch {
    /* lock store unavailable: do not block live writes */
  }
  return null
}

/** The entity itself was deleted: close an open lock so viewers see it, else nothing. */
export async function closeIfLocked(actor: DraftActor, type: DraftResourceType, id: string, reason: dl.ClosedReason = 'deleted') {
  try {
    const lock = await dl.getLock(pool, type, id, OPTS)
    if (lock && !lock.closedAt) await closeDraftLock(actor, type, id, reason)
  } catch (err) {
    console.error('[draft-locks] close failed for', type, id, err)
  }
}

/**
 * Assert inside a transaction the caller already runs (no-op without an actor). Calling it after
 * the draft write, before commit, is just as safe: a refusal rolls the write back.
 */
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

/** Close inside the caller's transaction; skipped without an actor (system writers, tests). */
export async function closeDraftLockTx(db: DraftDb | dl.SqlClient, actor: DraftActor, type: DraftResourceType, id: string, reason: dl.ClosedReason) {
  if (!actor?.adminId) return null
  return dl.close(db as dl.SqlClient, actor, type, id, reason, OPTS)
}

/** Publish / finalize / send: assert the lock, run the write, close the lock, one transaction. */
export async function withDraftPublish<T>(
  actor: DraftActor,
  type: DraftResourceType,
  id: string,
  fn: (db: DraftDb) => Promise<T>,
  opts: { epoch?: number | null; reason?: dl.ClosedReason } = {}
): Promise<T> {
  if (!actor?.adminId) return fn(poolDb)
  let closed: LockResult | null = null
  const out = await withTransaction(async client => {
    await dl.assertHolder(client, actor, type, id, { ...OPTS, epoch: opts.epoch })
    const value = await fn(client as unknown as DraftDb)
    closed = await dl.close(client, actor, type, id, opts.reason ?? 'published', OPTS)
    return value
  })
  await announceDraftClosed(actor, type, id, closed, opts.reason ?? 'published')
  return out
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

/**
 * Guard for an edit-page server action: discard needs canDiscard, every other intent the lock.
 * Redirects to the edit page in read-only mode when refused; returns the actor otherwise.
 */
export async function guardDraftAction(type: DraftResourceType, id: string, editPath: string, intent?: string | null): Promise<DraftActor> {
  const actor = await actionActor()
  if (!actor?.adminId) return actor
  if (intent !== 'discard') {
    await lockOrRedirect(type, id, editPath)
    return actor
  }
  const r = await canDiscard(actor, type, id)
  if (!r.ok) redirect(ap(`${editPath}${editPath.includes('?') ? '&' : '?'}locked=1`, await getHost()))
  return actor
}

/** Like guardDraftAction for actions that report instead of redirecting: the refusal message, or null. */
export async function draftActionError(type: DraftResourceType, id: string, intent?: string | null): Promise<string | null> {
  const actor = await actionActor()
  if (!actor?.adminId) return null
  if (intent === 'discard') {
    const r = await canDiscard(actor, type, id)
    return r.ok ? null : r.error.message
  }
  try {
    const res = await withTransaction(c => dl.assertHolder(c, actor, type, id, OPTS))
    await announce(actor, type, id, res)
    return null
  } catch (err) {
    if (dl.isDraftLockError(err)) return `${err.message}. Your changes were not saved.`
    throw err
  }
}

/** Edit-page URL for start*Draft: `locked=1` when someone else holds the draft. */
export function draftEditUrl(path: string, back: string | null | undefined, mine: boolean): string {
  const qs = [back ? `back=${encodeURIComponent(back)}` : '', mine ? '' : 'locked=1'].filter(Boolean).join('&')
  return qs ? `${path}?${qs}` : path
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

/**
 * List-row badges: the holder of each row's draft (only while they can still edit), keyed by id.
 * `me` marks the viewer's own drafts; omitted, it is read from the session.
 */
export async function draftLockChips(
  type: DraftResourceType,
  ids: (string | null | undefined)[],
  me?: string | null
): Promise<Record<string, DraftLockChip>> {
  const keys = [...new Set(ids.filter((v): v is string => !!v))]
  if (!keys.length) return {}
  const [locks, viewer] = await Promise.all([getDraftLockMap(type, keys), me === undefined ? actionActor() : null])
  const self = me === undefined ? (viewer?.adminId ?? null) : me
  const out: Record<string, DraftLockChip> = {}
  for (const [id, l] of Object.entries(locks)) {
    if (!l.ownerId || !l.ownerCanEdit) continue
    out[id] = { ownerId: l.ownerId, ownerName: l.ownerName, lastActiveAt: l.lastActiveAt, mine: l.ownerId === self }
  }
  return out
}

/** View pages: where "View draft (read-only)" goes when another admin holds the draft, else null. */
export async function heldDraftForView(type: DraftResourceType, id: string, editPath: string, back?: string | null) {
  const s = await initialDraftLock(type, id)
  const l = s?.lock
  if (!s?.draftExists || !l || l.closedAt || !l.ownerId || !l.ownerCanEdit || s.isMine) return null
  return { ownerName: l.ownerName ?? 'another admin', href: ap(draftEditUrl(editPath, back, false), await getHost()) }
}

/** Deactivated, deleted, or re-scoped admin: free their drafts (of `types`, else all) for others to claim. */
export async function releaseLocksOfAdmin(adminId: string, actor?: DraftActor, types?: DraftResourceType[]): Promise<number> {
  try {
    const freed = await withTransaction(c => dl.releaseLocksOfAdmin(c, adminId, types))
    for (const f of freed) {
      await publishLockEvent({ type: 'released', resourceType: f.resourceType, resourceId: f.resourceId, lock: null, by: actor?.adminId ?? null })
    }
    return freed.length
  } catch (err) {
    console.error('[draft-locks] releaseLocksOfAdmin failed for', adminId, err)
    return 0
  }
}

/** Scopes or role changed: free only the drafts whose write scope the admin no longer has. */
export async function releaseLocksOutOfScope(adminId: string, role: string, scopes: string[], actor?: DraftActor): Promise<number> {
  const lost = dl.DRAFT_RESOURCE_TYPES.filter(t => !hasScope(role, scopes, dl.DRAFT_RESOURCES[t].writeScope))
  return lost.length ? releaseLocksOfAdmin(adminId, actor, lost) : 0
}

/** Cron housekeeping: stale presence, orphaned locks, locks of inactive admins, old tombstones. */
export async function sweepDraftLocks() {
  return dl.sweep(pool)
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
