import { getTenant, getKyc, controlPlanePool } from '../tenant-registry'
import { getS3Url } from '../s3'
import { buildTenantPolicies, POLICY_VERSION, type TenantLegalInfo } from './generate'

// Provisioning glue for per-tenant legals. Fetches the tenant's business identity (KYC) +
// uploaded logo/seal, builds their templated legal pages, and stores them so the tenant's
// storefront can serve {slug}.jeffistores.in/legal/*. Stored as a JSON blob in the tenant's
// own S3 bucket (legal/policies.json) — no per-tenant-DB schema change, and the storefront
// reads it from there. Non-fatal by contract: the caller wraps this in try/catch.
//
// _endpoint is accepted for symmetry with other data-plane steps (in case a future version
// writes into the tenant DB instead of S3), but the S3-blob approach needs only the bucket.
export async function generateTenantLegals(tenantId: string, _endpoint?: string): Promise<void> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('tenant not found')
  const kyc = await getKyc(tenantId).catch(() => null)

  const info: TenantLegalInfo = {
    businessName: kyc?.business_name || tenant.display_name,
    slug: tenant.slug,
    address: kyc?.business_address || '',
    gstin: kyc?.gst_number || undefined,
    email: tenant.noreply_email || undefined,
    phone: kyc?.mobile || undefined,
    logoUrl: kyc?.logo_s3_key ? await getS3Url(kyc.logo_s3_key) : undefined,
    sealUrl: kyc?.seal_s3_key ? await getS3Url(kyc.seal_s3_key) : undefined,
  }

  const built = buildTenantPolicies(info)
  const bucket = tenant.s3_bucket || `jeffi-tenant-${tenant.slug}`
  const body = JSON.stringify({ version: POLICY_VERSION, generatedAt: new Date().toISOString(), policies: built })

  // Write the policies blob to the tenant's bucket (public-read via CloudFront/OAC like other assets).
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: 'legal/policies.json',
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300',
  }))

  // Record generation on the KYC row (best-effort).
  await controlPlanePool().query(
    `UPDATE tenant_kyc SET legals_accepted_version=COALESCE(legals_accepted_version,$2), updated_at=now() WHERE tenant_id=$1`,
    [tenantId, POLICY_VERSION],
  ).catch(() => {})
}
