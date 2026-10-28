import type { DraftResourceType } from '@jeffi/draft-locks'
import { query } from '@/lib/shared/db'
import { changedPaths, type ArrayKeys, type Content } from './draft-merge'
import type { DraftDb } from './draft-locks'

// One row per change to a draftable entity (entity_revisions). Publishes write one; so do direct
// writes (list toggles, bulk edits) via recordDirectRevision, so a merge can name who changed what.

export interface RevisionRow {
  revision: number
  draft_id: string | null
  draft_title: string | null
  actor_admin_id: string | null
  actor_name: string | null
  source: string
  changes: Record<string, { from: unknown; to: unknown }>
  created_at: string
}

const poolDb: DraftDb = { query: (t, p) => query(t, p) }

export async function currentRevision(db: DraftDb, type: DraftResourceType, id: string): Promise<number> {
  const r = await db.query<{ rev: number }>(
    `SELECT COALESCE(MAX(revision), 0)::int AS rev FROM entity_revisions WHERE resource_type = $1 AND resource_id = $2`,
    [type, id]
  )
  return r.rows[0]?.rev ?? 0
}

export async function adminName(db: DraftDb, adminId: string | null | undefined): Promise<string | null> {
  if (!adminId) return null
  const r = await db.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS name
       FROM admins a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [adminId]
  )
  return r.rows[0]?.name ?? null
}

/** Records the change from `before` to `after` (nothing when equal). Caller holds the entity row lock. */
export async function recordRevision(
  db: DraftDb,
  r: {
    type: DraftResourceType
    id: string
    before: Content
    after: Content
    arrayKeys?: ArrayKeys
    actorAdminId?: string | null
    draftId?: string | null
    draftTitle?: string | null
    source?: 'publish' | 'direct' | 'import' | 'system'
  }
): Promise<number | null> {
  const changes = changedPaths(r.before, r.after, r.arrayKeys)
  if (!Object.keys(changes).length) return null
  const name = await adminName(db, r.actorAdminId)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ins = await db.query<{ revision: number }>(
        `INSERT INTO entity_revisions (resource_type, resource_id, revision, draft_id, draft_title, actor_admin_id, actor_name, source, changes)
         SELECT $1::varchar, $2::uuid, COALESCE(MAX(revision), 0) + 1, $3::uuid, $4, $5::uuid, $6, $7, $8::jsonb
           FROM entity_revisions WHERE resource_type = $1::varchar AND resource_id = $2::uuid
         RETURNING revision`,
        [r.type, r.id, r.draftId ?? null, r.draftTitle ?? null, r.actorAdminId ?? null, name, r.source ?? 'publish', JSON.stringify(changes)]
      )
      return ins.rows[0]?.revision ?? null
    } catch (err: any) {
      // Two direct writes raced for the same number: take the next one.
      if (err?.code !== '23505' || attempt === 2) throw err
    }
  }
  return null
}

/** For writes outside a draft. Never fails the write it follows. */
export async function recordDirectRevision(
  r: Omit<Parameters<typeof recordRevision>[1], 'source'> & { source?: 'direct' | 'import' | 'system' },
  db: DraftDb = poolDb
): Promise<void> {
  try {
    await recordRevision(db, { ...r, source: r.source ?? 'direct' })
  } catch (err) {
    console.error('[entity-revisions] direct revision failed', r.type, r.id, err)
  }
}

export async function revisionsSince(db: DraftDb, type: DraftResourceType, id: string, after: number): Promise<RevisionRow[]> {
  const r = await db.query<RevisionRow>(
    `SELECT revision, draft_id, draft_title, actor_admin_id, actor_name, source, changes, created_at
       FROM entity_revisions WHERE resource_type = $1 AND resource_id = $2 AND revision > $3
      ORDER BY revision DESC`,
    [type, id, after]
  )
  return r.rows
}

/** The newest revision that touched `path` (or anything under an element path). */
export function lastTouch(revs: RevisionRow[], path: string): RevisionRow | null {
  return revs.find(r => Object.keys(r.changes ?? {}).some(k => k === path || k.startsWith(`${path}.`) || path.startsWith(`${k}.`))) ?? null
}
