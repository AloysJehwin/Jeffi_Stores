import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))
const store = vi.hoisted(() => ({ deleteBackupByKey: vi.fn(async () => {}), deleteArchivePrefix: vi.fn(async () => 0) }))
vi.mock('@/lib/tenancy/tenant-backup-store', () => store)

import {
  archiveRetentionDays,
  parseArchiveKeep,
  createTenantArchive,
  expireTenantArchives,
  getOwnerArchive,
  reclaimableTenantId,
} from '@/lib/tenant-registry/archives'

describe('tenant archives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockResolvedValue({ rows: [] })
  })
  afterEach(() => {
    delete process.env.TENANT_ARCHIVE_RETENTION_DAYS
  })

  it('keeps data for 30 days unless configured', () => {
    expect(archiveRetentionDays()).toBe(30)
    process.env.TENANT_ARCHIVE_RETENTION_DAYS = '45'
    expect(archiveRetentionDays()).toBe(45)
    process.env.TENANT_ARCHIVE_RETENTION_DAYS = 'soon'
    expect(archiveRetentionDays()).toBe(30)
  })

  it('accepts a keep choice only when the administrator decided all three items', () => {
    expect(parseArchiveKeep({ database: true, media: false, config: true })).toEqual({ database: true, media: false, config: true })
    expect(parseArchiveKeep({ database: true, media: false })).toBeNull()
    expect(parseArchiveKeep({ database: 'yes', media: false, config: true })).toBeNull()
    expect(parseArchiveKeep(null)).toBeNull()
  })

  it('records an item as kept only when its copy exists', async () => {
    query.mockResolvedValue({ rows: [{ id: 'arch-1' }] })
    await createTenantArchive({ tenantId: 't1', ownerId: 'o1', slug: 'acme', dbBackupKey: null, mediaPrefix: 'tenant-backups/media/o1/acme/S/', config: null })
    const args = query.mock.calls[0][1]
    // keep_database, keep_media, keep_config
    expect(args.slice(4, 7)).toEqual([false, true, false])
    expect(args[12]).toBe(30)
  })

  it('reads an archive for its owner only, while it can still be restored', async () => {
    await getOwnerArchive('o1', 'arch-1')
    const [sql, args] = query.mock.calls[0]
    expect(sql).toMatch(/owner_id = \$2/)
    expect(sql).toMatch(/status = 'available'/)
    expect(sql).toMatch(/expires_at > now\(\)/)
    expect(args).toEqual(['arch-1', 'o1'])
  })

  it('deletes the kept data of archives past their date, then marks them expired', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT')
        ? { rows: [{ id: 'a1', slug: 'acme', db_backup_key: 'tenant-backups/by-owner/o1/x.sql.gz', media_prefix: 'tenant-backups/media/o1/acme/S/' }] }
        : { rows: [], rowCount: 1 }
    )
    expect(await expireTenantArchives()).toEqual({ expired: 1, failed: 0 })
    expect(query.mock.calls[0][0]).toMatch(/expires_at <= now\(\)/)
    expect(store.deleteBackupByKey).toHaveBeenCalledWith('tenant-backups/by-owner/o1/x.sql.gz', 'acme')
    expect(store.deleteArchivePrefix).toHaveBeenCalledWith('tenant-backups/media/o1/acme/S/')
    expect(query.mock.calls[1][0]).toMatch(/SET status = 'expired'/)
  })

  it('leaves an archive as it is when its data could not be deleted, to try again', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT') ? { rows: [{ id: 'a1', slug: 'acme', db_backup_key: null, media_prefix: 'tenant-backups/media/o1/acme/S/' }] } : { rows: [] }
    )
    store.deleteArchivePrefix.mockRejectedValueOnce(new Error('AccessDenied'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await expireTenantArchives()).toEqual({ expired: 0, failed: 1 })
    expect(query).toHaveBeenCalledTimes(1) // never marked expired
    err.mockRestore()
  })

  it('lets only the owner of a terminated store take its name again', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 't-old' }] })
    expect(await reclaimableTenantId('o1', 'acme')).toBe('t-old')
    const [sql, args] = query.mock.calls[0]
    expect(sql).toMatch(/t\.status = 'terminated'/)
    expect(sql).toMatch(/ot\.owner_id = \$2/)
    expect(args).toEqual(['acme', 'o1'])
    expect(await reclaimableTenantId('someone-else', 'acme')).toBeNull()
  })
})
