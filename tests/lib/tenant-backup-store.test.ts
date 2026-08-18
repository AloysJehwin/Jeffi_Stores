/**
 * Tests for src/lib/tenant-backup-store.ts
 *
 * When a store is deprovisioned its database is dumped here, and this is the ONLY
 * copy a returning owner can be restored from — so the dual-write (by-owner AND
 * by-slug) and the "newest wins" selection are what make re-onboarding work at
 * all. A returning owner is matched by EITHER their owner id or the slug they
 * re-use, which is why both prefixes must always be written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const s3Send = vi.fn()
function cmd(name: string) {
  return vi.fn().mockImplementation(function (this: any, input: any) {
    this.__type = name
    this.input = input
  })
}
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (this: any) { this.send = s3Send }),
  PutObjectCommand: cmd('PutObject'),
  GetObjectCommand: cmd('GetObject'),
  ListObjectsV2Command: cmd('ListObjectsV2'),
}))

function inputs() { return s3Send.mock.calls.map((c: any[]) => c[0]?.input) }
function types() { return s3Send.mock.calls.map((c: any[]) => c[0]?.__type) }

async function importStore() {
  vi.resetModules()
  return import('@/lib/tenant-backup-store')
}

describe('tenant-backup-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    s3Send.mockResolvedValue({})
    delete process.env.PLATFORM_S3_BUCKET
    delete process.env.S3_BUCKET_NAME
    delete process.env.S3_BUCKET
  })
  afterEach(() => {
    delete process.env.PLATFORM_S3_BUCKET
    delete process.env.S3_BUCKET_NAME
    delete process.env.S3_BUCKET
  })

  // -------------------------------------------------------------------------
  describe('putTenantBackup — dual write', () => {
    it('writes the SAME bytes under both the owner and slug prefixes', async () => {
      const { putTenantBackup } = await importStore()
      const buf = Buffer.from('dump-bytes')
      const out = await putTenantBackup({ buffer: buf, ownerId: 'o-1', slug: 'acme', capturedAt: '2026-08-18T10:20:30.123Z' })

      expect(types()).toEqual(['PutObject', 'PutObject'])
      expect(out.ownerKey).toBe('tenant-backups/by-owner/o-1/2026-08-18T10-20-30-123Z.sql.gz')
      expect(out.slugKey).toBe('tenant-backups/by-slug/acme/2026-08-18T10-20-30-123Z.sql.gz')
      const bodies = inputs().map((i) => i.Body)
      expect(bodies[0]).toBe(buf)
      expect(bodies[1]).toBe(buf)
    })

    it('stores gzip content type and searchable metadata', async () => {
      const { putTenantBackup } = await importStore()
      await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o-1', slug: 'acme', capturedAt: '2026-08-18T10:20:30.123Z' })
      expect(inputs()[0]).toMatchObject({
        ContentType: 'application/gzip',
        Metadata: { owner_id: 'o-1', slug: 'acme', captured_at: '2026-08-18T10:20:30.123Z' },
      })
    })

    it('defaults capturedAt to now when not supplied', async () => {
      const { putTenantBackup } = await importStore()
      const out = await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o-1', slug: 'acme' })
      expect(out.ownerKey).toMatch(/^tenant-backups\/by-owner\/o-1\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.sql\.gz$/)
    })

    it('never puts a colon in the key (S3 tooling safety)', async () => {
      const { putTenantBackup } = await importStore()
      const out = await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o-1', slug: 'acme' })
      expect(out.ownerKey).not.toContain(':')
      expect(out.slugKey).not.toContain(':')
    })

    it('uses the default platform bucket', async () => {
      const { putTenantBackup } = await importStore()
      await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o', slug: 's' })
      expect(inputs()[0].Bucket).toBe('jeffi-stores-bucket')
    })

    it('honours PLATFORM_S3_BUCKET first', async () => {
      process.env.PLATFORM_S3_BUCKET = 'custom-bucket'
      const { putTenantBackup } = await importStore()
      await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o', slug: 's' })
      expect(inputs()[0].Bucket).toBe('custom-bucket')
    })

    it('falls back to S3_BUCKET_NAME', async () => {
      process.env.S3_BUCKET_NAME = 'named-bucket'
      const { putTenantBackup } = await importStore()
      await putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o', slug: 's' })
      expect(inputs()[0].Bucket).toBe('named-bucket')
    })

    it('propagates an S3 failure rather than reporting a phantom backup', async () => {
      const { putTenantBackup } = await importStore()
      s3Send.mockRejectedValueOnce(new Error('AccessDenied'))
      await expect(putTenantBackup({ buffer: Buffer.from('x'), ownerId: 'o', slug: 's' }))
        .rejects.toThrow('AccessDenied')
    })
  })

  // -------------------------------------------------------------------------
  describe('findLatestBackup', () => {
    const key = (p: string, t: string) => `tenant-backups/${p}/${t}.sql.gz`

    it('returns null when neither ownerId nor slug is given', async () => {
      const { findLatestBackup } = await importStore()
      await expect(findLatestBackup({})).resolves.toBeNull()
      expect(s3Send).not.toHaveBeenCalled()
    })

    it('returns null when the prefixes are empty', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [] })
      await expect(findLatestBackup({ ownerId: 'o-1' })).resolves.toBeNull()
    })

    it('returns the NEWEST backup across both prefixes', async () => {
      const { findLatestBackup } = await importStore()
      s3Send
        .mockResolvedValueOnce({ Contents: [{ Key: key('by-owner/o-1', '2026-08-01T00-00-00-000Z'), Size: 10 }] })
        .mockResolvedValueOnce({ Contents: [{ Key: key('by-slug/acme', '2026-08-17T00-00-00-000Z'), Size: 20 }] })

      const out = await findLatestBackup({ ownerId: 'o-1', slug: 'acme' })
      expect(out?.key).toContain('2026-08-17')
      expect(out?.sizeBytes).toBe(20)
    })

    it('parses the ISO timestamp back out of the key', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [{ Key: key('by-owner/o-1', '2026-08-18T10-20-30-123Z'), Size: 1 }] })
      const out = await findLatestBackup({ ownerId: 'o-1' })
      expect(out?.capturedAt).toBe('2026-08-18T10:20:30.123Z')
    })

    it('ignores objects that are not .sql.gz', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [{ Key: 'tenant-backups/by-owner/o-1/readme.txt', Size: 1 }] })
      await expect(findLatestBackup({ ownerId: 'o-1' })).resolves.toBeNull()
    })

    it('tolerates a missing Contents array', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({})
      await expect(findLatestBackup({ ownerId: 'o-1' })).resolves.toBeNull()
    })

    it('SURVIVES a listing error on one prefix and still uses the other', async () => {
      const { findLatestBackup } = await importStore()
      s3Send
        .mockRejectedValueOnce(new Error('AccessDenied'))
        .mockResolvedValueOnce({ Contents: [{ Key: key('by-slug/acme', '2026-08-17T00-00-00-000Z'), Size: 5 }] })
      const out = await findLatestBackup({ ownerId: 'o-1', slug: 'acme' })
      expect(out?.key).toContain('by-slug/acme')
    })

    it('only lists the owner prefix when no slug is given', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [] })
      await findLatestBackup({ ownerId: 'o-1' })
      expect(s3Send).toHaveBeenCalledTimes(1)
      expect(inputs()[0].Prefix).toBe('tenant-backups/by-owner/o-1/')
    })

    it('only lists the slug prefix when no ownerId is given', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [] })
      await findLatestBackup({ slug: 'acme' })
      expect(inputs()[0].Prefix).toBe('tenant-backups/by-slug/acme/')
    })

    it('falls back to the raw basename for a non-standard key', async () => {
      const { findLatestBackup } = await importStore()
      s3Send.mockResolvedValue({ Contents: [{ Key: 'tenant-backups/by-owner/o-1/legacy-dump.sql.gz', Size: 1 }] })
      const out = await findLatestBackup({ ownerId: 'o-1' })
      expect(out?.capturedAt).toBe('legacy-dump')
    })
  })

  // -------------------------------------------------------------------------
  describe('getTenantBackup', () => {
    it('returns the object bytes as a Buffer', async () => {
      const { getTenantBackup } = await importStore()
      s3Send.mockResolvedValue({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      })
      const buf = await getTenantBackup('tenant-backups/by-owner/o-1/x.sql.gz')
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect([...buf]).toEqual([1, 2, 3])
    })

    it('requests the right bucket and key', async () => {
      const { getTenantBackup } = await importStore()
      s3Send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1]) } })
      await getTenantBackup('some/key.sql.gz')
      expect(inputs()[0]).toMatchObject({ Bucket: 'jeffi-stores-bucket', Key: 'some/key.sql.gz' })
    })

    it('throws when S3 returns an empty body', async () => {
      const { getTenantBackup } = await importStore()
      s3Send.mockResolvedValue({})
      await expect(getTenantBackup('k')).rejects.toThrow(/Empty S3 response for backup k/)
    })
  })
})

