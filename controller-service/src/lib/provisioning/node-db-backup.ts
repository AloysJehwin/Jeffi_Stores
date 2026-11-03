import 'server-only'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { controlPlanePool } from '@/lib/tenant-registry'
import { dumpTenantDb } from '@controller/lib/tenancy/tenant-db-backup'
import { TENANT_DB_NAME, withTenantAdminPool } from './tenant-admin-pool'

// Daily logical backup of every database that runs on a store's own server (RDS keeps its own
// automated backups; these have none). Same bucket, archive and file naming as the teardown backups
// (tenant-backup-store.ts), under tenant-backups/by-slug/{slug}/daily/: a hard purge of the store
// deletes them with the rest, and restore-on-re-onboard sees them only when no teardown backup is newer.
// Run hourly; each store is dumped once its newest daily is DUE_AFTER_MS old, within a time budget so
// one call stays inside the cron request timeout. The EBS snapshots (tenant-db-snapshots.sh) are the
// fast rollback; these are the copy off the volume.

const KEEP = 14
const DUE_AFTER_MS = 20 * 3600_000
const BUDGET_MS = 240_000

const s3 = () => new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
const bucket = () => process.env.PLATFORM_S3_BUCKET || process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || 'jeffi-stores-bucket'
const dailyPrefix = (slug: string) => `tenant-backups/by-slug/${slug}/daily/`
const stamp = (iso: string) => iso.replace(/[:.]/g, '-')

interface NodeDb {
  tenantId: string
  slug: string
  endpoint: string
  dbName: string | null
  dbSecretRef: string
}

/** Active stores whose database runs on their own server (password auth, a secret ref). */
async function nodeDbs(): Promise<NodeDb[]> {
  const r = await controlPlanePool().query(
    `SELECT t.id, t.slug, i.rds_endpoint, i.rds_db, i.db_secret_ref
       FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id
      WHERE t.status = 'active' AND i.iam_auth = false AND i.db_secret_ref IS NOT NULL AND i.rds_endpoint IS NOT NULL
      ORDER BY t.slug`
  )
  return r.rows.map(x => ({ tenantId: x.id, slug: x.slug, endpoint: x.rds_endpoint, dbName: x.rds_db, dbSecretRef: x.db_secret_ref }))
}

async function dailyKeys(slug: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: dailyPrefix(slug), ContinuationToken: token }))
    for (const o of res.Contents ?? []) if (o.Key?.endsWith('.sql.gz')) keys.push(o.Key)
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  // Stamps sort as time.
  return keys.sort()
}

/** The ISO time a daily key was taken (reverse of stamp()), or 0. */
function takenAt(key: string): number {
  const m = key.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql\.gz$/)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0
}

async function backupOne(db: NodeDb): Promise<string> {
  const database = db.dbName || TENANT_DB_NAME
  const archive = await withTenantAdminPool({ endpoint: db.endpoint, dbName: database, iamAuth: false, dbSecretRef: db.dbSecretRef }, pool =>
    dumpTenantDb(pool, { database })
  )
  const iso = new Date().toISOString()
  const key = `${dailyPrefix(db.slug)}${stamp(iso)}.sql.gz`
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: archive,
      ContentType: 'application/gzip',
      Metadata: { slug: db.slug, tenant_id: db.tenantId, captured_at: iso, kind: 'daily' },
    })
  )
  return key
}

async function prune(slug: string): Promise<number> {
  const old = (await dailyKeys(slug)).slice(0, -KEEP)
  if (!old.length) return 0
  await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: old.map(Key => ({ Key })), Quiet: true } }))
  return old.length
}

export interface NodeDbBackupResult {
  backedUp: string[]
  notDue: number
  failed: { slug: string; error: string }[]
  /** Stores still due when the time budget ran out; the next run takes them. */
  deferred: string[]
}

export async function backupNodeDbs(now = Date.now()): Promise<NodeDbBackupResult> {
  const out: NodeDbBackupResult = { backedUp: [], notDue: 0, failed: [], deferred: [] }
  const started = Date.now()
  for (const db of await nodeDbs()) {
    try {
      const last = (await dailyKeys(db.slug)).at(-1)
      if (last && now - takenAt(last) < DUE_AFTER_MS) {
        out.notDue++
        continue
      }
      if (Date.now() - started > BUDGET_MS) {
        out.deferred.push(db.slug)
        continue
      }
      await backupOne(db)
      await prune(db.slug)
      out.backedUp.push(db.slug)
    } catch (e: any) {
      out.failed.push({ slug: db.slug, error: e?.message || String(e) })
    }
  }
  return out
}
