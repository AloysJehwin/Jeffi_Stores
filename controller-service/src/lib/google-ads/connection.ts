import { getIntegrationCredential } from '@/lib/tenant-registry'
import { oauthProviderInfo, type OAuthProviderInfo } from '@/lib/integrations/oauth'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { loadGoogleServiceAccount } from '@/lib/shared/google-credentials'
import { GOOGLE_ADS_PROVIDER, googleAdsEnvStatus, type GoogleAdsEnvStatus, type AdsConnectedVia } from './credentials'

export interface AdsConnectionStatus {
  env: GoogleAdsEnvStatus
  oauth: OAuthProviderInfo
  /** The flagship store, which can also use the platform service account. */
  flagship: boolean
  /** Flagship only: the service account to add as a user in Google Ads. */
  serviceAccountEmail: string | null
  connected: boolean
  /** Signed in with Google but no account picked yet. */
  pendingAccount: boolean
  connectedVia: AdsConnectedVia | null
  customerId: string | null
  loginCustomerId: string | null
  accountName: string | null
}

function serviceAccountEmail(): string | null {
  try {
    return loadGoogleServiceAccount().client_email || null
  } catch {
    return null
  }
}

/** Non-secret connection state for the Google Ads page (never decrypts the token). */
export async function getAdsConnectionStatus(tenantKey: string): Promise<AdsConnectionStatus> {
  const row = await getIntegrationCredential(tenantKey, GOOGLE_ADS_PROVIDER).catch(() => null)
  const live = !!row && row.status === 'connected'
  const meta = (live ? row!.meta : null) ?? {}
  const customerId = meta.customer_id ? String(meta.customer_id) : null
  const env = googleAdsEnvStatus()
  const flagship = tenantKey === PLATFORM_TENANT_ID
  const base = {
    env,
    oauth: oauthProviderInfo('google_ads'),
    flagship,
    serviceAccountEmail: flagship ? serviceAccountEmail() : null,
    pendingAccount: live && !customerId,
  }
  // Flagship with no account stored: the flagship's own account through the platform service account.
  if (!customerId && flagship && env.platformCustomerId) {
    return {
      ...base,
      connected: true,
      connectedVia: 'platform',
      customerId: env.platformCustomerId,
      loginCustomerId: env.managerId,
      accountName: null,
    }
  }
  return {
    ...base,
    connected: live && !!customerId,
    connectedVia: (meta.connected_via as AdsConnectedVia) ?? null,
    customerId,
    loginCustomerId: meta.login_customer_id ? String(meta.login_customer_id) : null,
    accountName: meta.account_name ? String(meta.account_name) : null,
  }
}
