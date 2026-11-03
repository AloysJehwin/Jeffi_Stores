import { getIntegrationCredential } from '@/lib/tenant-registry'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { GOOGLE_ADS_PROVIDER, adsTenantKey, googleAdsEnvStatus, type AdsConnectedVia } from '../credentials'
import { SCOPE_MISSING } from './data-manager'
import type { ConversionAuth, DataManagerAccess, UploadRunSummary } from './types'

// Can the connection's credentials send conversions through the Data Manager API? Read from the
// credential's meta (no decrypting) plus the last run's error, for the Conversions tab prompt.

const SCOPE_CODES = new Set([SCOPE_MISSING, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'])

export function dataManagerAccess(
  meta: Record<string, any> | null,
  via: AdsConnectedVia | null,
  lastRun: UploadRunSummary | null
): DataManagerAccess {
  if (!via) return 'not_connected'
  // A scope error from a run before the latest sign-in no longer applies.
  const grantedAt = meta?.data_manager_at ? Date.parse(String(meta.data_manager_at)) : 0
  const scopeError =
    !!lastRun?.errorCode && SCOPE_CODES.has(lastRun.errorCode) && !(grantedAt && Date.parse(lastRun.finishedAt || '') < grantedAt)
  if (via === 'platform') return scopeError ? 'missing' : 'service_account'
  if (via === 'manager') return scopeError ? 'missing' : 'manager'
  if (meta?.data_manager === true) return scopeError ? 'missing' : 'granted'
  // Google sign-ins before conversion uploads only asked for Google Ads.
  if (meta?.data_manager === false || via === 'oauth') return 'missing'
  return scopeError ? 'missing' : 'unknown'
}

export async function conversionAuth(lastRun: UploadRunSummary | null): Promise<ConversionAuth> {
  try {
    const key = await adsTenantKey()
    const row = await getIntegrationCredential(key, GOOGLE_ADS_PROVIDER).catch(() => null)
    const meta: Record<string, any> = row?.status === 'connected' ? (row.meta ?? {}) : {}
    let via: AdsConnectedVia | null = meta.customer_id ? ((meta.connected_via as AdsConnectedVia) ?? null) : null
    if (!via && key === PLATFORM_TENANT_ID && googleAdsEnvStatus().platformCustomerId) via = 'platform'
    return { connectedVia: via, dataManager: dataManagerAccess(meta, via, lastRun) }
  } catch {
    return { connectedVia: null, dataManager: 'unknown' }
  }
}
