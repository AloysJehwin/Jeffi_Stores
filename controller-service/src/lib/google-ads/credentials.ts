import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { loadGoogleServiceAccount } from '@/lib/shared/google-credentials'
import { GoogleAdsClient, normalizeCustomerId, GOOGLE_ADS_SCOPE, type GoogleAdsClientOptions, type ServiceAccountKey } from './client'

// Google Ads credentials live in their own tenant_integration_credentials row (provider
// 'google_ads', adwords scope) so connecting Ads never replaces the Merchant Center token. The
// flagship is keyed to PLATFORM_TENANT_ID like the Sheets flow, so flagship and tenants share one path.
//
// connected_via:
//   oauth   - the store signed in with Google; refresh token is theirs (pending until an account is picked)
//   manual  - customer id + refresh token entered by hand
//   manager - the platform manager account (GOOGLE_ADS_LOGIN_CUSTOMER_ID) manages the store's account,
//             using the platform refresh token GOOGLE_ADS_MANAGER_REFRESH_TOKEN
//   platform - flagship only, with no stored row: the flagship's own account GOOGLE_ADS_CUSTOMER_ID read
//             with the platform Google service account (the one the Merchant sync uses), added
//             as a user in Google Ads. Tenants never fall back to it.

export const GOOGLE_ADS_PROVIDER = 'google_ads'
export { GOOGLE_ADS_SCOPE }

export type AdsConnectedVia = 'oauth' | 'manual' | 'manager' | 'platform'

export interface GoogleAdsConfig {
  oauth_refresh_token?: string
  customer_id?: string
  login_customer_id?: string
  connected_via: AdsConnectedVia
}

export interface GoogleAdsCreds {
  refreshToken?: string
  serviceAccount?: ServiceAccountKey
  customerId: string
  loginCustomerId: string | null
  connectedVia: AdsConnectedVia
}

export interface GoogleAdsEnvStatus {
  developerToken: boolean
  oauthClient: boolean
  managerId: string | null
  managerRefreshToken: boolean
  /** Flagship's own account read with the platform service account (GOOGLE_ADS_CUSTOMER_ID). */
  platformCustomerId: string | null
  ready: boolean
  missing: string[]
}

/** Which platform-side settings are present; drives the "not configured" state. */
export function googleAdsEnvStatus(env: Record<string, string | undefined> = process.env): GoogleAdsEnvStatus {
  const missing: string[] = []
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN')
  if (!env.GOOGLE_OAUTH_CLIENT_ID) missing.push('GOOGLE_OAUTH_CLIENT_ID')
  if (!env.GOOGLE_OAUTH_CLIENT_SECRET) missing.push('GOOGLE_OAUTH_CLIENT_SECRET')
  const managerId = normalizeCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null
  return {
    developerToken: !!env.GOOGLE_ADS_DEVELOPER_TOKEN,
    oauthClient: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    managerId,
    managerRefreshToken: !!env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN,
    platformCustomerId: normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID) || null,
    ready: missing.length === 0,
    missing,
  }
}

/** The credential key for the current request: the tenant, or the platform sentinel on the flagship. */
export async function adsTenantKey(tenantId?: string | null): Promise<string> {
  return tenantId ?? (await resolveTenantId()) ?? PLATFORM_TENANT_ID
}

export async function readAdsConfig(tenantKey: string): Promise<GoogleAdsConfig | null> {
  const row = await getIntegrationCredential(tenantKey, GOOGLE_ADS_PROVIDER)
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc)) as GoogleAdsConfig
  } catch {
    return null
  }
}

export async function saveAdsConfig(
  tenantKey: string,
  cfg: GoogleAdsConfig,
  meta: Record<string, any> = {}
): Promise<void> {
  const customerId = normalizeCustomerId(cfg.customer_id)
  const loginCustomerId = normalizeCustomerId(cfg.login_customer_id)
  const clean: GoogleAdsConfig = {
    connected_via: cfg.connected_via,
    ...(cfg.oauth_refresh_token ? { oauth_refresh_token: cfg.oauth_refresh_token } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
    ...(loginCustomerId && loginCustomerId !== customerId ? { login_customer_id: loginCustomerId } : {}),
  }
  await saveIntegrationCredential({
    tenantId: tenantKey,
    provider: GOOGLE_ADS_PROVIDER,
    label: 'Google Ads',
    configEnc: encryptToken(JSON.stringify(clean)),
    meta: {
      connected_via: clean.connected_via,
      customer_id: clean.customer_id ?? null,
      login_customer_id: clean.login_customer_id ?? null,
      needs_customer: !clean.customer_id,
      ...meta,
    },
  })
}

export async function deleteAdsConfig(tenantKey: string): Promise<void> {
  await deleteIntegrationCredential(tenantKey, GOOGLE_ADS_PROVIDER)
}

/** Credentials usable for API calls, from a stored config. Throws when incomplete. */
export function credsFromConfig(cfg: GoogleAdsConfig | null, tenantKey: string): GoogleAdsCreds {
  if (cfg?.connected_via === 'manager') {
    const managerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
    const token = process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN
    if (!managerId || !token || !cfg.customer_id) throw new IntegrationNotConnectedError(GOOGLE_ADS_PROVIDER, tenantKey)
    return { refreshToken: token, customerId: cfg.customer_id, loginCustomerId: managerId, connectedVia: 'manager' }
  }
  if (!cfg?.oauth_refresh_token || !cfg.customer_id) throw new IntegrationNotConnectedError(GOOGLE_ADS_PROVIDER, tenantKey)
  return {
    refreshToken: cfg.oauth_refresh_token,
    customerId: cfg.customer_id,
    loginCustomerId: cfg.login_customer_id ?? null,
    connectedVia: cfg.connected_via,
  }
}

/** Flagship fallback: its own Ads account through the platform service account, or null. */
export function platformAdsCreds(tenantKey: string): GoogleAdsCreds | null {
  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID)
  if (tenantKey !== PLATFORM_TENANT_ID || !customerId) return null
  const sa = loadGoogleServiceAccount()
  return {
    serviceAccount: { clientEmail: sa.client_email, privateKey: sa.private_key },
    customerId,
    loginCustomerId: normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null,
    connectedVia: 'platform',
  }
}

export async function resolveGoogleAdsCreds(tenantId?: string | null): Promise<GoogleAdsCreds> {
  const key = await adsTenantKey(tenantId)
  const cfg = await readAdsConfig(key)
  if (!cfg?.customer_id && key === PLATFORM_TENANT_ID) {
    const platform = platformAdsCreds(key)
    if (platform) return platform
  }
  return credsFromConfig(cfg, key)
}

export async function googleAdsClientFor(
  tenantId?: string | null,
  extra: Partial<GoogleAdsClientOptions> = {}
): Promise<GoogleAdsClient> {
  const c = await resolveGoogleAdsCreds(tenantId)
  return new GoogleAdsClient({
    refreshToken: c.refreshToken,
    serviceAccount: c.serviceAccount,
    customerId: c.customerId,
    loginCustomerId: c.loginCustomerId,
    ...extra,
  })
}

/** Platform manager client (for the "managed by the platform" mode); null when not configured. */
export function managerClient(extra: Partial<GoogleAdsClientOptions> = {}): GoogleAdsClient | null {
  const managerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
  const token = process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN
  if (!managerId || !token || !process.env.GOOGLE_ADS_DEVELOPER_TOKEN) return null
  return new GoogleAdsClient({ refreshToken: token, customerId: managerId, ...extra })
}
