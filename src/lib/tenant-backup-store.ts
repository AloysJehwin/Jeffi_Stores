import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

/**
 * Tenant DB backup storage in the platform S3 bucket (jeffi-stores-bucket).
 *
 * A deprovisioned store's DB is snapshotted (see tenant-db-backup.ts) and written under
 * TWO prefixes so a returning owner can be matched by EITHER their owner id or the store
 * slug they re-use:
 *     tenant-backups/by-owner/{ownerId}/{ISO}.sql.gz
 *     tenant-backups/by-slug/{slug}/{ISO}.sql.gz
 * Both hold identical bytes. Restore-on-re-onboard lists these prefixes and offers the
 * newest object.
 */

function getS3Client(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
}

/** Platform bucket — same resolution as KYC uploads. */
function backupBucket(): string {
  const b =
    process.env.PLATFORM_S3_BUCKET ||
    process.env.S3_BUCKET_NAME ||
    process.env.S3_BUCKET ||
    'jeffi-stores-bucket'
  if (!b) throw new Error('No S3 bucket configured for tenant backups')
  return b
}

const PREFIX = 'tenant-backups'
function ownerPrefix(ownerId: string) { return `${PREFIX}/by-owner/${ownerId}/` }
function slugPrefix(slug: string) { return `${PREFIX}/by-slug/${slug}/` }

// S3 keys can't contain ':' cleanly in all tooling — use a filesystem-safe stamp.
function stamp(iso: string) { return iso.replace(/[:.]/g, '-') }

export interface BackupRef {
  key: string
  capturedAt: string   // ISO, parsed back from the key stamp
  sizeBytes?: number
}

/**
 * Write the backup bytes under both the owner and slug prefixes.
 * Returns the canonical (by-owner) key.
 */
export async function putTenantBackup(opts: {
  buffer: Buffer
  ownerId: string
  slug: string
  capturedAt?: string
}): Promise<{ ownerKey: string; slugKey: string }> {
  const iso = opts.capturedAt ?? new Date().toISOString()
  const file = `${stamp(iso)}.sql.gz`
  const ownerKey = `${ownerPrefix(opts.ownerId)}${file}`
  const slugKey = `${slugPrefix(opts.slug)}${file}`
  const s3 = getS3Client()
  const bucket = backupBucket()
  const common = { Bucket: bucket, Body: opts.buffer, ContentType: 'application/gzip' as const }
  await Promise.all([
    s3.send(new PutObjectCommand({ ...common, Key: ownerKey, Metadata: { owner_id: opts.ownerId, slug: opts.slug, captured_at: iso } })),
    s3.send(new PutObjectCommand({ ...common, Key: slugKey, Metadata: { owner_id: opts.ownerId, slug: opts.slug, captured_at: iso } })),
  ])
  return { ownerKey, slugKey }
}

/** Parse the ISO timestamp back out of a backup key's filename. */
function capturedAtFromKey(key: string): string {
  const file = key.split('/').pop() || ''
  const base = file.replace(/\.sql\.gz$/, '')
  // reverse of stamp(): the date part uses '-' for both ':' and '.', restore best-effort.
  // Format: YYYY-MM-DDTHH-MM-SS-mmmZ  → YYYY-MM-DDTHH:MM:SS.mmmZ
  const m = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/)
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`
  return base
}

async function listPrefix(prefix: string): Promise<BackupRef[]> {
  const s3 = getS3Client()
  const res = await s3.send(new ListObjectsV2Command({ Bucket: backupBucket(), Prefix: prefix }))
  return (res.Contents ?? [])
    .filter((o) => o.Key && o.Key.endsWith('.sql.gz'))
    .map((o) => ({ key: o.Key!, capturedAt: capturedAtFromKey(o.Key!), sizeBytes: o.Size }))
}

/**
 * Find the most recent backup for an owner and/or slug. Lists both prefixes (as provided)
 * and returns the newest by key timestamp. Returns null if none exist.
 */
export async function findLatestBackup(opts: { ownerId?: string; slug?: string }): Promise<BackupRef | null> {
  const lists: Promise<BackupRef[]>[] = []
  if (opts.ownerId) lists.push(listPrefix(ownerPrefix(opts.ownerId)).catch(() => []))
  if (opts.slug) lists.push(listPrefix(slugPrefix(opts.slug)).catch(() => []))
  if (lists.length === 0) return null
  const all = (await Promise.all(lists)).flat()
  if (all.length === 0) return null
  // Dedupe by capturedAt (owner+slug copies share the stamp) and pick newest.
  all.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))
  return all[0]
}

/** Fetch backup bytes by key. */
export async function getTenantBackup(key: string): Promise<Buffer> {
  const s3 = getS3Client()
  const res = await s3.send(new GetObjectCommand({ Bucket: backupBucket(), Key: key }))
  if (!res.Body) throw new Error('Empty S3 response for backup ' + key)
  const bytes = await res.Body.transformToByteArray()
  return Buffer.from(bytes)
}
