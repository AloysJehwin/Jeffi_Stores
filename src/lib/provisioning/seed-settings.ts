import { Pool } from 'pg'
import { createPgPool, rdsSslOption } from '@/lib/shared/pg-pool'
import { getTenant, getKyc, getDraft } from '../tenant-registry'

/**
 * Seed a freshly-provisioned tenant's own `site_settings` from what the owner entered during
 * onboarding (control-plane tenant record + KYC + onboarding draft warehouse).
 *
 * Without this the tenant boots with an empty `site_settings` and `site-controls.ts` falls back
 * to a slug-derived store name, blank contact/logo and platform-default business values — the
 * onboarding identity is silently dropped. Mirrors the identity mapping in legals/provision.ts
 * so the storefront legals and site identity stay consistent.
 *
 * Idempotent: every key is UPSERTed on the table's UNIQUE(key), so a retried step updates in
 * place. Non-fatal by contract — the caller wraps this in try/catch and advances regardless.
 */

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const DEFAULT_BUCKET = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''

function tenantMasterPool(endpoint: string, dbName: string): Pool {
  const masterPassword = process.env.RDS_MASTER_PASSWORD
  if (!masterPassword) throw new Error('RDS_MASTER_PASSWORD is not set — required to seed a tenant DB')
  const user = process.env.TENANT_RDS_MASTER_USER || process.env.RDS_MASTER_USER || 'postgres'
  return createPgPool({
    host: endpoint,
    port: 5432,
    database: dbName,
    user,
    password: masterPassword,
    ssl: rdsSslOption(),
    max: 2,
    connectionTimeoutMillis: 20000,
  })
}

function stateCodeFromGst(gst: string | null | undefined): string {
  if (!gst) return ''
  const prefix = gst.trim().slice(0, 2)
  return /^\d{2}$/.test(prefix) ? prefix : ''
}

/** Copy the KYC logo from the platform bucket into the tenant bucket and return its public URL. */
async function copyLogoToTenantBucket(logoS3Key: string, tenantBucket: string): Promise<string | null> {
  const { S3Client, CopyObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({ region: AWS_REGION })
  const key = `${KEY_PREFIX}${logoS3Key}`
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: tenantBucket,
        Key: key,
        CopySource: `/${DEFAULT_BUCKET}/${key}`,
        MetadataDirective: 'COPY',
        CacheControl: 'public, max-age=300',
      })
    )
    return `https://${tenantBucket}.s3.${AWS_REGION}.amazonaws.com/${key}`
  } catch {
    return null
  }
}

export async function seedTenantSiteSettings(
  tenantId: string,
  ownerId: string,
  endpoint: string,
  dbName: string
): Promise<void> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('tenant not found')
  const kyc = await getKyc(tenantId).catch(() => null)
  const draft = await getDraft(ownerId).catch(() => null)
  const wh = (draft?.data as any)?.wh ?? {}
  const identity = (draft?.data as any)?.identity ?? {}

  const businessName = kyc?.business_name || tenant.display_name || ''
  const businessAddress = kyc?.business_address || ''
  const businessPhone = kyc?.mobile || wh.sellerPhone || ''
  const businessEmail = identity.email || ''
  const domain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const businessWeb = tenant.custom_domain || `${tenant.slug}.${domain}`
  const stateCode = stateCodeFromGst(kyc?.gst_number) || (identity.state_code ?? '')

  let logoUrl = ''
  if (kyc?.logo_s3_key && (tenant.s3_bucket || '')) {
    logoUrl = (await copyLogoToTenantBucket(kyc.logo_s3_key, tenant.s3_bucket as string)) ?? ''
  }

  const settings: Record<string, string> = {
    business_name: businessName,
    business_email: businessEmail,
    business_phone: businessPhone,
    business_web: businessWeb,
    business_logo_url: logoUrl,
    business_state_code: stateCode,
    delhivery_origin_pincode: wh.originPincode ?? '',
    delhivery_pickup_location: wh.pickupLocation ?? '',
    delhivery_seller_name: wh.sellerName || businessName,
    delhivery_seller_address: wh.sellerAddress || businessAddress,
    delhivery_seller_phone: wh.sellerPhone || businessPhone,
  }

  const entries = Object.entries(settings).filter(([, v]) => v != null && String(v).trim() !== '')
  if (entries.length === 0) return

  const pool = tenantMasterPool(endpoint, dbName)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}
