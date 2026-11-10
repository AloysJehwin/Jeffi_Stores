import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { controlPlanePool, getTenantUpiId, UPI_MODES, type UpiMode } from '@/lib/tenant-registry'
import { storedPhonePeCreds as storedPhonePeBlob } from '@/lib/integrations/resolve'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { phonePeEnv, type PhonePeClientCreds } from './phonepe'

/**
 * Who collects a merchant's UPI payments (docs/plans/UPI_UPG_V2.md §1). A merchant is the platform
 * (tenantId null: the flagship store and every payment made to the platform) or a store. Its provider
 * follows what it saved: PhonePe credentials → 'phonepe'; else a UPI ID → 'upg'; else 'none'. A store's
 * UPI money always reaches the store; nothing is collected on the platform's account for it.
 */

export { UPI_MODES, type UpiMode }

export interface PhonePeCreds extends PhonePeClientCreds {
  merchantId?: string
  webhookUsername?: string
  webhookPassword?: string
}

export type UpiProviderName = 'phonepe' | 'upg' | 'none'
export type UpiProviderChoice = { provider: 'phonepe'; creds: PhonePeCreds } | { provider: 'upg'; vpa: string } | { provider: 'none' }

export const isPlatformMerchant = (id: string | null | undefined) => !id || id === PLATFORM_TENANT_ID

/** The platform's PhonePe account from env, or null when not configured. */
export function envPhonePeCreds(): PhonePeCreds | null {
  const clientId = process.env.PHONEPE_CLIENT_ID || ''
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) return null
  return {
    env: phonePeEnv(process.env.PHONEPE_ENV),
    clientId,
    clientSecret,
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
    merchantId: process.env.PHONEPE_MERCHANT_ID || undefined,
    webhookUsername: process.env.PHONEPE_WEBHOOK_USERNAME || undefined,
    webhookPassword: process.env.PHONEPE_WEBHOOK_PASSWORD || undefined,
  }
}

/** Saved PhonePe credentials (tenant_integration_credentials 'phonepe') for a tenant id, as the client takes them. */
export async function storedPhonePeCreds(tenantId: string): Promise<PhonePeCreds | null> {
  if (!tenantId) return null
  const c = await storedPhonePeBlob(tenantId)
  if (!c) return null
  return {
    env: phonePeEnv(c.env),
    clientId: c.client_id,
    clientSecret: c.client_secret,
    clientVersion: c.client_version,
    merchantId: c.merchant_id,
    webhookUsername: c.webhook_username,
    webhookPassword: c.webhook_password,
  }
}

/** The platform's PhonePe account: saved under PLATFORM_TENANT_ID, else env. */
export async function platformPhonePeCreds(): Promise<PhonePeCreds | null> {
  return (await storedPhonePeCreds(PLATFORM_TENANT_ID).catch(() => null)) ?? envPhonePeCreds()
}

const TTL_MS = 30_000
const modeCache = new Map<string, { mode: UpiMode; at: number }>()
const settingCache = new Map<string, { value: string | null; at: number }>()

export function invalidateUpiModeCache(tenantId?: string) {
  if (tenantId) modeCache.delete(tenantId)
  else modeCache.clear()
  settingCache.clear()
}

/** A flagship site setting, read straight from the flagship DB so a store's request can ask too. */
export async function platformSiteSetting(key: string): Promise<string | null> {
  const hit = settingCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const { rows } = await controlPlanePool().query(`SELECT value FROM site_settings WHERE key = $1`, [key])
  const value = rows[0]?.value != null ? String(rows[0].value) : null
  settingCache.set(key, { value, at: Date.now() })
  return value
}

/** tenants.upi_mode ('auto' | 'off'); 'auto' for the platform, when unset, or when the control plane can't be read. */
export async function resolveUpiMode(tenantId?: string | null): Promise<UpiMode> {
  const id = tenantId ?? (await resolveTenantId())
  if (isPlatformMerchant(id)) return 'auto'
  const hit = modeCache.get(id!)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.mode
  let mode: UpiMode = 'auto'
  try {
    const { rows } = await controlPlanePool().query(`SELECT upi_mode FROM tenants WHERE id = $1`, [id])
    if (rows[0]?.upi_mode === 'off') mode = 'off'
  } catch {
    mode = 'auto'
  }
  modeCache.set(id!, { mode, at: Date.now() })
  return mode
}

/** The UPI ID a merchant is paid on: a store's from its bank details, the platform's from site setting upi_vpa (env RAZORPAY_UPI_VPA). */
export async function merchantUpiVpa(tenantId: string | null | undefined): Promise<string | null> {
  if (isPlatformMerchant(tenantId)) {
    const set = await platformSiteSetting('upi_vpa').catch(() => null)
    return set?.trim() || process.env.RAZORPAY_UPI_VPA?.trim() || null
  }
  const vpa = await getTenantUpiId(tenantId!).catch(() => null)
  return vpa?.trim() || null
}

/** PhonePe when its credentials are saved, else UPG on its UPI ID, else none. Kill switches are separate (upiStatus). */
export async function resolveUpiProvider(tenantId: string | null | undefined): Promise<UpiProviderChoice> {
  const creds = isPlatformMerchant(tenantId) ? await platformPhonePeCreds() : await storedPhonePeCreds(tenantId!).catch(() => null)
  if (creds) return { provider: 'phonepe', creds }
  const vpa = await merchantUpiVpa(tenantId)
  return vpa ? { provider: 'upg', vpa } : { provider: 'none' }
}

/** PhonePe credentials of the merchant that collected (refunds, status reads); throws when it has none. */
export async function resolvePhonePeCreds(tenantId?: string | null): Promise<PhonePeCreds> {
  const id = tenantId ?? (await resolveTenantId())
  const creds = isPlatformMerchant(id) ? await platformPhonePeCreds() : await storedPhonePeCreds(id!).catch(() => null)
  if (!creds) throw new Error('PhonePe is not configured for this account')
  return creds
}

/** env ENABLE_UPI is the platform's kill switch: an explicit off value stops UPI everywhere. */
export const platformUpiKilled = () => /^(false|0|off|no)$/i.test((process.env.ENABLE_UPI ?? '').trim())

export interface UpiStatus {
  provider: UpiProviderName
  killed: boolean
  reason?: string
}

async function merchantFlag(tenantId: string | null | undefined, current: string | null): Promise<boolean> {
  // The request's own store reads its Site Controls; the platform asked from a store's request reads the flagship's.
  if (isPlatformMerchant(tenantId) && !isPlatformMerchant(current)) {
    const v = await platformSiteSetting('feature_upi_enabled').catch(() => null)
    return v == null ? process.env.ENABLE_UPI === 'true' : v === 'true'
  }
  return (await getFeatureFlags()).upiEnabled
}

/** The provider in effect and whether a kill switch (env, Site Controls, the platform admin's upi_mode) stops it. */
export async function upiStatus(tenantId?: string | null): Promise<UpiStatus> {
  const current = await resolveTenantId().catch(() => null)
  const id = tenantId === undefined ? current : tenantId
  const { provider } = await resolveUpiProvider(id)
  if (platformUpiKilled()) return { provider, killed: true, reason: 'UPI is switched off for the whole platform.' }
  if (!(await merchantFlag(id, current).catch(() => false))) return { provider, killed: true, reason: 'UPI payments are switched off in Site Controls.' }
  if ((await resolveUpiMode(id)) === 'off') return { provider, killed: true, reason: 'The platform team has switched UPI off for this store.' }
  return { provider, killed: false }
}

/** UPI can be offered at this merchant's checkout. */
export async function upiAvailable(tenantId?: string | null): Promise<boolean> {
  const s = await upiStatus(tenantId).catch(() => null)
  return !!s && !s.killed && s.provider !== 'none'
}

/** Wallet top-ups pay the platform, on the platform's provider. */
export async function walletUpiAvailable(): Promise<boolean> {
  const s = await upiStatus(null).catch(() => null)
  return !!s && !s.killed && s.provider !== 'none'
}

/** The provider customers of the current store would pay on, or 'none' when UPI is unavailable. */
export async function activeUpiProvider(tenantId?: string | null): Promise<UpiProviderName> {
  const s = await upiStatus(tenantId).catch(() => null)
  return s && !s.killed ? s.provider : 'none'
}
