import { controlPlanePool } from './shared'

/**
 * What a deprovision kept for the store's owner. The administrator picks each item (database, media
 * files, configuration); the same owner coming back is offered what was kept and takes the store
 * name again. Kept data is deleted when the archive expires.
 */

export interface ArchiveKeep {
  database: boolean
  media: boolean
  config: boolean
}

export const KEEP_ALL: ArchiveKeep = { database: true, media: true, config: true }

/** Days a deprovisioned store's kept data stays before the sweep deletes it. */
export function archiveRetentionDays(): number {
  const n = Number(process.env.TENANT_ARCHIVE_RETENTION_DAYS)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30
}

/** `keep` from a request body: all three must be booleans, else null. */
export function parseArchiveKeep(raw: unknown): ArchiveKeep | null {
  const k = raw as Record<string, unknown> | null
  if (!k || typeof k !== 'object') return null
  if (typeof k.database !== 'boolean' || typeof k.media !== 'boolean' || typeof k.config !== 'boolean') return null
  return { database: k.database, media: k.media, config: k.config }
}

export interface TenantArchive {
  id: string
  tenant_id: string | null
  owner_id: string
  slug: string
  display_name: string | null
  keep_database: boolean
  keep_media: boolean
  keep_config: boolean
  db_backup_key: string | null
  media_prefix: string | null
  media_objects: number
  media_bytes: number
  config: Record<string, any>
  retention_days: number
  expires_at: string
  status: 'available' | 'restored' | 'expired'
  requested_by: string | null
  restored_tenant_id: string | null
  restored_at: string | null
  created_at: string
}

export interface CreateArchiveInput {
  tenantId: string
  ownerId: string
  slug: string
  displayName?: string | null
  dbBackupKey?: string | null
  mediaPrefix?: string | null
  mediaObjects?: number
  mediaBytes?: number
  config?: Record<string, any> | null
  requestedBy?: string | null
  retentionDays?: number
}

/** Record what a deprovision kept. Each `keep_*` is true only when that copy exists. */
export async function createTenantArchive(input: CreateArchiveInput): Promise<TenantArchive> {
  const days = input.retentionDays ?? archiveRetentionDays()
  const r = await controlPlanePool().query(
    `INSERT INTO tenant_archives
       (tenant_id, owner_id, slug, display_name, keep_database, keep_media, keep_config, db_backup_key,
        media_prefix, media_objects, media_bytes, config, retention_days, expires_at, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, now() + make_interval(days => $13), $14)
     RETURNING *`,
    [
      input.tenantId,
      input.ownerId,
      input.slug,
      input.displayName ?? null,
      !!input.dbBackupKey,
      !!input.mediaPrefix,
      !!input.config,
      input.dbBackupKey ?? null,
      input.mediaPrefix ?? null,
      input.mediaObjects ?? 0,
      input.mediaBytes ?? 0,
      JSON.stringify(input.config ?? {}),
      days,
      input.requestedBy ?? null,
    ]
  )
  return r.rows[0] as TenantArchive
}

/** The owner's newest archive that can still be restored (optionally for one store name). */
export async function findOwnerArchive(ownerId: string, opts: { slug?: string } = {}): Promise<TenantArchive | null> {
  const r = await controlPlanePool().query(
    `SELECT * FROM tenant_archives
      WHERE owner_id = $1 AND status = 'available' AND expires_at > now() AND ($2::text IS NULL OR slug = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [ownerId, opts.slug ?? null]
  )
  return (r.rows[0] as TenantArchive) ?? null
}

/** One archive, only for its owner and only while it can still be restored. */
export async function getOwnerArchive(ownerId: string, archiveId: string): Promise<TenantArchive | null> {
  const r = await controlPlanePool().query(
    `SELECT * FROM tenant_archives WHERE id = $1 AND owner_id = $2 AND status = 'available' AND expires_at > now()`,
    [archiveId, ownerId]
  )
  return (r.rows[0] as TenantArchive) ?? null
}

/** The archives of one store, newest first (the admin tenant page). */
export async function listTenantArchives(tenantId: string): Promise<TenantArchive[]> {
  const r = await controlPlanePool().query(`SELECT * FROM tenant_archives WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId])
  return r.rows as TenantArchive[]
}

export async function markArchiveRestored(archiveId: string, tenantId: string): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_archives SET status = 'restored', restored_tenant_id = $2, restored_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'available'`,
    [archiveId, tenantId]
  )
}

/** Archives whose kept data is due for deletion: past their date, or of a store being purged. */
export async function listArchivesToExpire(opts: { tenantId?: string; ownerId?: string; slug?: string } = {}): Promise<TenantArchive[]> {
  const byStore = opts.tenantId || (opts.ownerId && opts.slug)
  const r = await controlPlanePool().query(
    byStore
      ? `SELECT * FROM tenant_archives WHERE status <> 'expired' AND (tenant_id = $1::uuid OR (owner_id = $2::uuid AND slug = $3::text))`
      : `SELECT * FROM tenant_archives WHERE status <> 'expired' AND expires_at <= now() ORDER BY expires_at LIMIT 200`,
    byStore ? [opts.tenantId ?? null, opts.ownerId ?? null, opts.slug ?? null] : []
  )
  return r.rows as TenantArchive[]
}

export async function markArchiveExpired(archiveId: string): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_archives SET status = 'expired', keep_database = false, keep_media = false, keep_config = false,
            db_backup_key = NULL, media_prefix = NULL, config = '{}'::jsonb, updated_at = now()
      WHERE id = $1`,
    [archiveId]
  )
}

/**
 * Delete the kept data of archives that are due (see listArchivesToExpire) and mark them expired.
 * An archive whose objects could not be deleted stays as it is and is tried again next time.
 */
export async function expireTenantArchives(opts: { tenantId?: string; ownerId?: string; slug?: string } = {}): Promise<{ expired: number; failed: number }> {
  const due = await listArchivesToExpire(opts)
  if (!due.length) return { expired: 0, failed: 0 }
  const store = await import('@/lib/tenancy/tenant-backup-store')
  let expired = 0
  let failed = 0
  for (const a of due) {
    try {
      if (a.db_backup_key) await store.deleteBackupByKey(a.db_backup_key, a.slug)
      if (a.media_prefix) await store.deleteArchivePrefix(a.media_prefix)
      await markArchiveExpired(a.id)
      expired++
    } catch (e: any) {
      failed++
      console.error(`[archives] ${a.slug}: could not delete kept data of ${a.id}: ${e?.message || e}`)
    }
  }
  return { expired, failed }
}

/**
 * A store name held by a terminated store of this owner: the id of that tenants row, else null.
 * Only the same owner may take the name again; anyone else still finds it taken.
 */
export async function reclaimableTenantId(ownerId: string, slug: string): Promise<string | null> {
  const r = await controlPlanePool().query(
    `SELECT t.id FROM tenants t JOIN owner_tenants ot ON ot.tenant_id = t.id
      WHERE t.slug = $1 AND t.status = 'terminated' AND ot.owner_id = $2 LIMIT 1`,
    [slug, ownerId]
  )
  return r.rows[0]?.id ?? null
}
