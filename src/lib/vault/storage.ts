import 'server-only'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'

// Private storage for vault (digital-product) files. Separate from src/lib/shared/s3.ts, whose
// bucket is PUBLIC — vault bytes must never be world-readable. Two drivers behind one interface:
// an S3 driver (private bucket, presigned PUT/GET) and a local-filesystem driver for dev/tests.

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const VAULT_BUCKET = process.env.VAULT_S3_BUCKET || ''
const DEFAULT_GET_TTL = 90 // seconds — short-lived presigned reads
const DEFAULT_PUT_TTL = 15 * 60

export type StorageDriverName = 's3' | 'local'

export interface SignedGetOptions {
  /** 'inline' streams in the viewer; 'attachment' forces a download. */
  disposition?: 'inline' | 'attachment'
  filename?: string
  contentType?: string
  ttlSeconds?: number
}

export interface StorageDriver {
  readonly name: StorageDriverName
  /** A presigned/one-shot URL the admin's browser PUTs the file bytes to. */
  signUpload(key: string, contentType: string, ttlSeconds?: number): Promise<string>
  /** A short-lived URL the vault serves the file from (Range-capable for media). */
  signDownload(key: string, opts?: SignedGetOptions): Promise<string>
  delete(key: string): Promise<void>
  /** Byte size of a stored object, for quota accounting. */
  size(key: string): Promise<number>
}

/** Compose the storage key for a product file. Tenant-scoped so one bucket is safe across tenants. */
export function vaultKey(productId: string, fileId: string, ext: string): string {
  const tenantId = getCurrentTenantId() || 'platform'
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `vault/${tenantId}/${productId}/${fileId}${safeExt ? '.' + safeExt : ''}`
}

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const
  constructor(private bucket: string) {}

  signUpload(key: string, contentType: string, ttlSeconds = DEFAULT_PUT_TTL): Promise<string> {
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn: ttlSeconds,
    })
  }

  signDownload(key: string, opts: SignedGetOptions = {}): Promise<string> {
    const disp = opts.disposition ?? 'inline'
    const name = (opts.filename || key.split('/').pop() || 'file').replace(/["\\]/g, '')
    return getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Force a safe disposition + content type so an uploaded HTML/SVG can never render inline.
        ResponseContentDisposition: `${disp}; filename="${name}"`,
        ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
      }),
      { expiresIn: opts.ttlSeconds ?? DEFAULT_GET_TTL }
    )
  }

  async delete(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async size(key: string): Promise<number> {
    const r = await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
    return r.ContentLength ?? 0
  }
}

let cached: StorageDriver | null = null

/**
 * The active vault storage driver. S3 when VAULT_S3_BUCKET is set, else the local filesystem driver
 * (dev/tests, zero AWS). The local driver lives in a separate module so pulling in `fs` never
 * reaches an edge runtime by accident.
 */
export function getStorageDriver(): StorageDriver {
  if (cached) return cached
  if (VAULT_BUCKET) {
    cached = new S3StorageDriver(VAULT_BUCKET)
  } else {
    // Lazy require so the fs-based driver is only loaded when actually used.
    const { LocalStorageDriver } = require('./vault-storage-local') as typeof import('./vault-storage-local')
    cached = new LocalStorageDriver()
  }
  return cached
}

/** Test hook: reset the memoised driver. */
export function _resetStorageDriver(): void {
  cached = null
}
