import { NextResponse } from 'next/server'
import type { DraftResourceType } from '@jeffi/draft-locks'
import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import {
  announceDraftClosed,
  assertDraftHolder,
  closeDraftLockTx,
  DRAFT_RESOURCES,
  draftLockChips,
  withDraftCreate,
  type DraftActor,
  type DraftDb,
} from './draft-locks'
import { project, threeWayMerge, type ArrayKeys, type Content, type MergeConflict, type Resolution } from './draft-merge'
import { adminName, currentRevision, lastTouch, recordRevision, revisionsSince } from './entity-revisions'

// Several drafts per entity (docs/plans/MULTI_DRAFT_PLAN.md). A draft row is a branch: its own id
// (the lock key), author, the live content it started from (base) and that revision. Publish is a
// three-way merge against the newest live; overlapping edits come back as a 409 to resolve.

export interface DraftAdapter {
  type: DraftResourceType
  /** Draft table and the column holding the entity id. */
  table: string
  entityKey: string
  arrayKeys?: ArrayKeys
  /** Field labels for the merge dialog. */
  labels?: Record<string, string>
  /** Live content in the draft's shape, or null when the entity is gone. */
  live(db: DraftDb, entityId: string): Promise<Content | null>
  /** Draft row -> content; content -> the jsonb columns to write. */
  toContent(row: Record<string, any>): Content
  toColumns(content: Content): Record<string, unknown>
  /** Lock the live row for the merge (SELECT … FOR UPDATE). */
  lockLive(db: DraftDb, entityId: string): Promise<void>
  /** Write merged content to live, inside the publish transaction. */
  apply(db: DraftDb, entityId: string, merged: Content, live: Content, actor: DraftActor): Promise<void>
}

export interface DraftSummary {
  id: string
  entityId: string
  title: string | null
  authorId: string | null
  authorName: string | null
  baseRevision: number
  updatedAt: string
}

export class DraftConflictError extends Error {
  constructor(
    public conflicts: MergeConflict[],
    public liveRevision: number
  ) {
    super('Draft conflicts with changes published since it started')
  }
}

export class DraftNotFoundError extends Error {}

export function draftConflictResponse(err: unknown): NextResponse | null {
  if (err instanceof DraftConflictError)
    return NextResponse.json({ error: err.message, code: 'DRAFT_CONFLICT', conflicts: err.conflicts, liveRevision: err.liveRevision }, { status: 409 })
  if (err instanceof DraftNotFoundError) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  return null
}

const cols = (c: Record<string, unknown>) => Object.keys(c)

/** Starts a new draft of the entity for the actor (branch from live), locked to them. */
export async function createDraft(a: DraftAdapter, actor: DraftActor, entityId: string, opts: { title?: string | null; content?: Content } = {}): Promise<string> {
  const id = (await queryOne<{ id: string }>(`SELECT gen_random_uuid() AS id`))!.id
  await withDraftCreate(actor, a.type, id, async db => {
    const live = await a.live(db, entityId)
    if (!live) throw new DraftNotFoundError(`${a.type} ${entityId} not found`)
    const rev = await currentRevision(db, a.type, entityId)
    const c = a.toColumns(opts.content ?? live)
    const names = cols(c)
    await db.query(
      `INSERT INTO ${a.table} (id, ${a.entityKey}, author_admin_id, title, base, base_revision${names.map(n => `, ${n}`).join('')})
       VALUES ($1, $2, $3, $4, $5::jsonb, $6${names.map((_, i) => `, $${i + 7}::jsonb`).join('')})`,
      [id, entityId, actor?.adminId ?? null, opts.title?.trim() || null, JSON.stringify(live), rev, ...names.map(n => JSON.stringify(c[n]))]
    )
  })
  return id
}

/** Autosave / save: replace the draft's content. Caller wraps it in withDraftWrite(…, draftId). */
export async function saveDraftContent(a: DraftAdapter, db: DraftDb, draftId: string, content: Content, title?: string | null): Promise<boolean> {
  const c = a.toColumns(content)
  const names = cols(c)
  const r = await db.query(
    `UPDATE ${a.table} SET ${names.map((n, i) => `${n} = $${i + 2}::jsonb`).join(', ')}${title !== undefined ? `, title = $${names.length + 2}` : ''}, updated_at = now()
      WHERE id = $1`,
    [draftId, ...names.map(n => JSON.stringify(c[n])), ...(title !== undefined ? [title?.trim() || null] : [])]
  )
  return (r.rowCount ?? 0) > 0
}

export async function getDraftRow(a: DraftAdapter, draftId: string): Promise<Record<string, any> | null> {
  return queryOne(`SELECT * FROM ${a.table} WHERE id = $1`, [draftId])
}

/** Open drafts of one entity, newest first. */
export async function draftsOf(a: DraftAdapter, entityId: string): Promise<DraftSummary[]> {
  const rows = await queryMany<any>(
    `SELECT d.id, d.${a.entityKey} AS entity_id, d.title, d.author_admin_id, d.base_revision, d.updated_at,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS author_name
       FROM ${a.table} d LEFT JOIN admins ad ON ad.id = d.author_admin_id LEFT JOIN users u ON u.id = ad.user_id
      WHERE d.${a.entityKey} = $1 ORDER BY d.updated_at DESC`,
    [entityId]
  )
  return rows.map(r => ({
    id: r.id,
    entityId: r.entity_id,
    title: r.title,
    authorId: r.author_admin_id,
    authorName: r.author_name,
    baseRevision: r.base_revision ?? 0,
    updatedAt: r.updated_at,
  }))
}

export type DraftListing = DraftSummary & { behind: number; lock: import('@/lib/client/draft-lock-client').DraftLockChip | null }

/** View pages: the entity's drafts with who holds each and how many publishes landed since it started. */
export async function draftsForView(a: DraftAdapter, entityId: string, me?: string | null): Promise<DraftListing[]> {
  const drafts = await draftsOf(a, entityId)
  if (!drafts.length) return []
  const db: DraftDb = { query: (t, p) => query(t, p) }
  const [locks, rev] = await Promise.all([draftLockChips(a.type, drafts.map(d => d.id), me), currentRevision(db, a.type, entityId)])
  return drafts.map(d => ({ ...d, behind: Math.max(0, rev - d.baseRevision), lock: locks[d.id] ?? null }))
}

/** How far live has moved since the draft started, for the editor's "live changed" chip. */
export async function draftBehind(a: DraftAdapter, draftId: string) {
  const row = await getDraftRow(a, draftId)
  if (!row) return null
  const db: DraftDb = { query: (t, p) => query(t, p) }
  const revs = await revisionsSince(db, a.type, row[a.entityKey], row.base_revision ?? 0)
  if (!revs.length) return { behind: 0, last: null }
  const r = revs[0]
  return { behind: revs.length, last: { by: r.actor_name, at: r.created_at, draftTitle: r.draft_title, fields: Object.keys(r.changes ?? {}).length } }
}

/**
 * Publish = merge the draft into live. Throws DraftConflictError (→ 409) while overlapping edits
 * are unresolved; `resolutions` (path -> mine | theirs | { value }) settles them.
 */
export async function mergeAndPublish(
  a: DraftAdapter,
  draftId: string,
  actor: DraftActor,
  opts: { resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
): Promise<{ entityId: string; revision: number | null }> {
  let closed: Awaited<ReturnType<typeof closeDraftLockTx>> = null
  let entityId = ''
  let revision: number | null = null
  let title: string | null = null
  let siblings: { id: string; author_admin_id: string | null }[] = []
  await withTransaction(async client => {
    const db = client as unknown as DraftDb
    const row = (await db.query(`SELECT * FROM ${a.table} WHERE id = $1 FOR UPDATE`, [draftId])).rows[0]
    if (!row) throw new DraftNotFoundError(draftId)
    await assertDraftHolder(client, actor, a.type, draftId, { epoch: opts.epoch })
    entityId = row[a.entityKey]
    title = row.title ?? null
    await a.lockLive(db, entityId)
    const live = await a.live(db, entityId)
    if (!live) throw new DraftNotFoundError(entityId)
    const mine = a.toContent(row)
    // Drafts from before branches have no base: treat live as the base (their edits win, as before).
    const base = (row.base as Content | null) ?? live
    const shape = [mine, base]
    const liveP = project(live, shape)
    const r = threeWayMerge(project(base, shape), mine, liveP, { arrayKeys: a.arrayKeys, labels: a.labels, resolutions: opts.resolutions })
    if (r.conflicts.length) {
      const revs = await revisionsSince(db, a.type, entityId, row.base_revision ?? 0)
      for (const c of r.conflicts) {
        const t = lastTouch(revs, c.path)
        c.theirsBy = t ? (t.actor_name ?? (t.source === 'publish' ? 'Another admin' : `a ${t.source} change`)) : 'a change outside drafts'
        c.theirsAt = t?.created_at ?? null
      }
      throw new DraftConflictError(r.conflicts, revs[0]?.revision ?? row.base_revision ?? 0)
    }
    await a.apply(db, entityId, r.merged, live, actor)
    revision = await recordRevision(db, {
      type: a.type,
      id: entityId,
      before: liveP,
      after: r.merged,
      arrayKeys: a.arrayKeys,
      actorAdminId: actor?.adminId,
      draftId,
      draftTitle: title,
    })
    await db.query(`DELETE FROM ${a.table} WHERE id = $1`, [draftId])
    closed = await closeDraftLockTx(client, actor, a.type, draftId, 'published')
    siblings = (await db.query(`SELECT id, author_admin_id FROM ${a.table} WHERE ${a.entityKey} = $1`, [entityId])).rows
  })
  await announceDraftClosed(actor, a.type, draftId, closed, 'published')
  await notifyDraftSiblings(a.type, actor, entityId, title, siblings)
  return { entityId, revision }
}

/** Tells the authors of the entity's other drafts that live moved under them. */
export async function notifyDraftSiblings(
  type: DraftResourceType,
  actor: DraftActor,
  entityId: string,
  title: string | null,
  siblings: { id: string; author_admin_id: string | null }[]
) {
  if (!siblings.length) return
  try {
    const db: DraftDb = { query: (t, p) => query(t, p) }
    const who = (await adminName(db, actor?.adminId)) ?? 'An admin'
    const label = DRAFT_RESOURCES[type].label.toLowerCase()
    for (const s of siblings) {
      if (!s.author_admin_id || s.author_admin_id === actor?.adminId) continue
      const href = DRAFT_RESOURCES[type].editHref(s.id, entityId)
      await createAdminNotification({
        type: `draft_base_moved`,
        category: 'drafts',
        title: `${who} published changes to a ${label} you have a draft of`,
        message: `${title ? `“${title}” was merged. ` : ''}Your draft will show any overlapping fields when you publish.`,
        link: href,
        entityType: type,
        entityId: s.id,
        recipientAdminId: s.author_admin_id,
      })
    }
  } catch (err) {
    console.error('[draft-branches] sibling notify failed', err)
  }
}

export async function discardDraftRow(a: DraftAdapter, draftId: string): Promise<string | null> {
  const r = await queryOne<{ entity_id: string }>(`DELETE FROM ${a.table} WHERE id = $1 RETURNING ${a.entityKey} AS entity_id`, [draftId])
  return r?.entity_id ?? null
}
