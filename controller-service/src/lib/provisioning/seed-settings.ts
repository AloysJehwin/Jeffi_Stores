import {
  getTenant,
  getKyc,
  getOwnerById,
  getOwnerBankAccount,
  getTenantBankAccount,
  getTenantWarehouse,
  controlPlanePool,
  type TenantWarehouse,
} from '@/lib/tenant-registry'
import { getStateCode, stateNameFromCode } from '@/lib/catalog/gst'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { withTenantAdminPool, type TenantDbTarget } from './tenant-admin-pool'

/**
 * Seed a store's own `site_settings` from what the owner entered at onboarding (control-plane
 * tenant + KYC + warehouse + payout bank), so the admin panel, storefront and documents show the
 * registered business instead of slug/blank/platform defaults.
 *
 * Fill-only by default: a key the owner has already set is never overwritten, so a re-run is
 * safe. `force` restores the overwrite (except the favicon, which is always fill-only).
 */

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const DEFAULT_BUCKET = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL?.replace(/\/$/, '') ?? ''
const LOOKUP_TIMEOUT_MS = 5000
const ALWAYS_FILL_ONLY = new Set(['business_favicon_url'])

export interface SeedTarget extends TenantDbTarget {
  /** Overwrite keys the owner already set (default: only fill blanks). */
  force?: boolean
}

export interface SeedResult {
  attempted: number
  written: number
}

function stateCodeFromGst(gst: string | null | undefined): string {
  const prefix = (gst ?? '').trim().slice(0, 2)
  return /^\d{2}$/.test(prefix) ? prefix : ''
}

/** 2–4 uppercase initials of the store name; else the first three letters of the slug. */
export function invoicePrefixFor(displayName: string | null | undefined, slug: string): string {
  const initials = (displayName ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w[0])
    .filter(c => /[A-Za-z]/.test(c))
    .join('')
    .toUpperCase()
    .slice(0, 4)
  if (initials.length >= 2) return initials
  return slug.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'INV'
}

function platformPublicUrl(key: string): string {
  const full = `${KEY_PREFIX}${key}`
  return CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/${full}` : `https://${DEFAULT_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${full}`
}

/** Copy a KYC asset into the tenant bucket; the platform URL when the copy is not possible. */
async function copyAssetToTenantBucket(s3Key: string, tenantBucket: string | null | undefined): Promise<string> {
  if (!tenantBucket) return platformPublicUrl(s3Key)
  const key = `${KEY_PREFIX}${s3Key}`
  try {
    const { S3Client, CopyObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({ region: AWS_REGION })
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
    return platformPublicUrl(s3Key)
  }
}

async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const t = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(fallback), LOOKUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([p.catch(() => fallback), t])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Bank name + branch for an IFSC (Razorpay's public directory); blanks when unreachable. */
export async function lookupIfsc(ifsc: string | null | undefined): Promise<{ bank: string; branch: string }> {
  const code = (ifsc ?? '').trim().toUpperCase()
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return { bank: '', branch: '' }
  return withTimeout(
    (async () => {
      const res = await fetch(`https://ifsc.razorpay.com/${code}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
      if (!res.ok) return { bank: '', branch: '' }
      const data = await res.json()
      return { bank: String(data?.BANK ?? '').trim(), branch: String(data?.BRANCH ?? '').trim() }
    })(),
    { bank: '', branch: '' }
  )
}

async function cityForPincode(pin: string, tenantId: string): Promise<string> {
  if (!/^\d{6}$/.test(pin)) return ''
  const { checkPincodeServiceability } = await import('@/lib/shipping/delhivery')
  const r = await withTimeout(checkPincodeServiceability(pin, tenantId), null)
  return r?.district?.trim() ?? ''
}

async function verifiedCustomDomain(tenantId: string): Promise<string> {
  const r = await controlPlanePool()
    .query(
      `SELECT domain FROM tenant_custom_domains WHERE tenant_id=$1 AND status='verified' ORDER BY created_at LIMIT 1`,
      [tenantId]
    )
    .catch(() => null)
  return r?.rows?.[0]?.domain ?? ''
}

async function ownerFor(tenantId: string): Promise<string | null> {
  const r = await controlPlanePool()
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId])
    .catch(() => null)
  return r?.rows?.[0]?.owner_id ?? null
}

/** The onboarding values as site_settings keys (blank values dropped). */
export async function buildSeedSettings(tenantId: string, ownerIdIn?: string | null): Promise<Record<string, string>> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('tenant not found')
  const ownerId = ownerIdIn || (await ownerFor(tenantId))
  const kyc = await getKyc(tenantId).catch(() => null)
  const owner = ownerId ? await getOwnerById(ownerId).catch(() => null) : null
  const bank =
    (await getTenantBankAccount(tenantId).catch(() => null)) ??
    (ownerId ? await getOwnerBankAccount(ownerId).catch(() => null) : null)
  const wh: TenantWarehouse = (await getTenantWarehouse(tenantId).catch(() => null)) ?? {}

  const displayName = tenant.display_name?.trim() || ''
  const legalName = kyc?.business_name?.trim() || ''
  const businessName = displayName || legalName
  const businessAddress = kyc?.business_address?.trim() || ''
  const businessPhone = kyc?.mobile || wh.sellerPhone || ''
  const domain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const businessWeb = (await verifiedCustomDomain(tenantId)) || `${tenant.slug}.${domain}`
  const pincode = (wh.originPincode || businessAddress.match(/\b(\d{6})\b/)?.[1] || '').replace(/\D/g, '')

  let stateCode = stateCodeFromGst(kyc?.gst_number)
  if (!stateCode) stateCode = getStateCode(stateFromPincode(pincode) ?? '')

  const [ifsc, city, logoUrl, sealUrl] = await Promise.all([
    lookupIfsc(bank?.ifsc),
    cityForPincode(pincode, tenantId).catch(() => ''),
    kyc?.logo_s3_key ? copyAssetToTenantBucket(kyc.logo_s3_key, tenant.s3_bucket) : Promise.resolve(''),
    kyc?.seal_s3_key ? copyAssetToTenantBucket(kyc.seal_s3_key, tenant.s3_bucket) : Promise.resolve(''),
  ])

  const settings: Record<string, string> = {
    business_name: businessName,
    business_email: owner?.email || '',
    business_phone: businessPhone,
    business_web: businessWeb,
    business_logo_url: logoUrl,
    business_favicon_url: logoUrl,
    business_seal_url: sealUrl,
    business_state_code: stateCode,
    business_legal_name: legalName,
    business_trade_name: displayName,
    business_gstin: kyc?.gst_number || '',
    business_address: businessAddress,
    business_state: stateNameFromCode(stateCode),
    business_city: city,
    business_pincode: pincode,
    invoice_prefix: invoicePrefixFor(displayName, tenant.slug),
    bank_account: bank?.account_number || '',
    bank_ifsc: (bank?.ifsc || '').toUpperCase(),
    bank_name: ifsc.bank,
    bank_branch: ifsc.branch,
    bank_holder_name: bank?.verified_name || bank?.holder_name || '',
    delhivery_origin_pincode: pincode,
    delhivery_pickup_location: wh.pickupLocation || tenant.slug,
    delhivery_seller_name: wh.sellerName || businessName,
    delhivery_seller_address: wh.sellerAddress || businessAddress,
    delhivery_seller_phone: String(wh.sellerPhone || businessPhone).replace(/\D/g, '').slice(-10),
  }
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => v != null && String(v).trim() !== ''))
}

export async function seedTenantSiteSettings(
  tenantId: string,
  ownerId: string | null,
  target: SeedTarget
): Promise<SeedResult> {
  if (!target?.endpoint) throw new Error('tenant DB endpoint is required')
  const settings = await buildSeedSettings(tenantId, ownerId)
  const entries = Object.entries(settings)
  if (entries.length === 0) return { attempted: 0, written: 0 }

  return withTenantAdminPool(target, async pool => {
    const client = await pool.connect()
    let written = 0
    try {
      await client.query('BEGIN')
      for (const [key, value] of entries) {
        const overwrite = target.force && !ALWAYS_FILL_ONLY.has(key)
        const r = await client.query(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
           ${overwrite ? '' : `WHERE site_settings.value IS NULL OR site_settings.value = ''`}`,
          [key, String(value)]
        )
        written += r.rowCount ?? 0
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    return { attempted: entries.length, written }
  })
}

/**
 * Write kept site_settings into a store's database without touching a key that already has a value
 * (what onboarding seeded stays). Returns how many keys were written.
 */
export async function applySiteSettings(target: SeedTarget, settings: Record<string, string>): Promise<{ attempted: number; written: number }> {
  if (!target?.endpoint) throw new Error('tenant DB endpoint is required')
  const entries = Object.entries(settings).filter(([, v]) => v != null && String(v).trim() !== '')
  if (entries.length === 0) return { attempted: 0, written: 0 }
  return withTenantAdminPool(target, async pool => {
    const client = await pool.connect()
    let written = 0
    try {
      await client.query('BEGIN')
      for (const [key, value] of entries) {
        const r = await client.query(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
           WHERE site_settings.value IS NULL OR site_settings.value = ''`,
          [key, String(value)]
        )
        written += r.rowCount ?? 0
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    return { attempted: entries.length, written }
  })
}
