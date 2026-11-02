import 'server-only'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { controlPlanePool } from '@/lib/tenant-registry'

// Per-tenant S3 bucket size, written nightly into tenant_infra.s3_usage_bytes so the cap guard in
// @jeffi/tenancy's s3.ts can reject writes without touching the bucket on every request. ListObjectsV2
// pages 1000 keys at a time; big buckets pay a listing cost once a day.

const REGION = process.env.AWS_REGION || 'us-east-1'
let client: S3Client | null = null
const s3 = () => (client ??= new S3Client({ region: REGION }))

async function bucketSizeBytes(bucket: string): Promise<number> {
  let total = 0
  let token: string | undefined
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }))
    for (const o of r.Contents ?? []) total += o.Size ?? 0
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return total
}

/** Walk every tenant with its own bucket, write the latest size + timestamp. */
export async function updateAllTenantS3Usage(): Promise<{ scanned: number; failed: number }> {
  const r = await controlPlanePool().query<{ tenant_id: string; s3_bucket: string }>(
    `SELECT tenant_id, s3_bucket FROM tenant_infra WHERE s3_bucket IS NOT NULL AND s3_bucket <> ''`
  )
  let scanned = 0, failed = 0
  for (const row of r.rows) {
    try {
      const bytes = await bucketSizeBytes(row.s3_bucket)
      await controlPlanePool().query(
        `UPDATE tenant_infra SET s3_usage_bytes = $1, s3_usage_updated_at = now() WHERE tenant_id = $2`,
        [bytes, row.tenant_id]
      )
      scanned++
    } catch {
      failed++
    }
  }
  return { scanned, failed }
}
