import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { fetchWithRetry } from '@/lib/channels/ratelimit'

// Amazon Ads API (Sponsored Products v3, Reporting v3). Its own Login with Amazon app, separate
// from the Selling Partner app: AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET. India profiles are
// served by the EU endpoint. Credentials are a tenant_integration_credentials row 'amazon_ads';
// the flagship is keyed to the platform tenant like Google Ads.

export const AMAZON_ADS_PROVIDER = 'amazon_ads'
export const AMAZON_ADS_SCOPE = 'advertising::campaign_management'
export const ADS_API = process.env.AMAZON_ADS_API_HOST || 'https://advertising-api-eu.amazon.com'
export const LWA_AUTHORIZE = process.env.AMAZON_ADS_AUTHORIZE_URL || 'https://eu.account.amazon.com/ap/oa'
export const LWA_TOKEN = process.env.AMAZON_ADS_TOKEN_URL || 'https://api.amazon.co.uk/auth/o2/token'

export interface AmazonAdsConfig {
  refresh_token: string
  profile_id?: string
  profile_name?: string
  country_code?: string
  currency_code?: string
  connected_via: 'oauth' | 'manual'
}

export class AmazonAdsApiError extends Error {
  constructor(
    public httpStatus: number,
    message: string
  ) {
    super(message)
    this.name = 'AmazonAdsApiError'
  }
}

export const adsEnvReady = () => !!(process.env.AMAZON_ADS_CLIENT_ID && process.env.AMAZON_ADS_CLIENT_SECRET)

export async function amazonAdsTenantKey(): Promise<string> {
  return (await resolveTenantId()) ?? PLATFORM_TENANT_ID
}

export async function readAmazonAdsConfig(tenantKey?: string): Promise<AmazonAdsConfig | null> {
  const row = await getIntegrationCredential(tenantKey ?? (await amazonAdsTenantKey()), AMAZON_ADS_PROVIDER).catch(() => null)
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc)) as AmazonAdsConfig
  } catch {
    return null
  }
}

export async function saveAmazonAdsConfig(tenantKey: string, cfg: AmazonAdsConfig): Promise<void> {
  await saveIntegrationCredential({
    tenantId: tenantKey,
    provider: AMAZON_ADS_PROVIDER,
    label: cfg.profile_name ? `Amazon Ads (${cfg.profile_name})` : 'Amazon Ads',
    configEnc: encryptToken(JSON.stringify(cfg)),
    meta: { profile_id: cfg.profile_id ?? null, profile_name: cfg.profile_name ?? null, connected_via: cfg.connected_via },
  })
}

export async function disconnectAmazonAds(tenantKey: string): Promise<void> {
  await deleteIntegrationCredential(tenantKey, AMAZON_ADS_PROVIDER)
}

const tokens = new Map<string, { token: string; expiresAt: number }>()

export async function lwaAccessToken(refreshToken: string): Promise<string> {
  const hit = tokens.get(refreshToken)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token
  const res = await fetch(LWA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.AMAZON_ADS_CLIENT_ID ?? '',
      client_secret: process.env.AMAZON_ADS_CLIENT_SECRET ?? '',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new AmazonAdsApiError(401, `Amazon Ads sign-in failed: ${data.error_description || data.error || res.status}`)
  tokens.set(refreshToken, { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 })
  return data.access_token
}

export interface AdsRequest {
  body?: unknown
  /** Media type for SP v3 endpoints, e.g. 'spCampaign' (sent as application/vnd.spCampaign.v3+json). */
  vnd?: string
  contentType?: string
  profile?: boolean
}

export class AmazonAdsClient {
  constructor(
    private refreshToken: string,
    public profileId: string | null
  ) {}

  async request<T = any>(method: string, path: string, opts: AdsRequest = {}): Promise<T> {
    const token = await lwaAccessToken(this.refreshToken)
    const type = opts.contentType ?? (opts.vnd ? `application/vnd.${opts.vnd}.v3+json` : 'application/json')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID ?? '',
      'Content-Type': type,
      Accept: type,
    }
    if (opts.profile !== false && this.profileId) headers['Amazon-Advertising-API-Scope'] = this.profileId
    const res = await fetchWithRetry(`${ADS_API}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) {
      const msg = data?.message || data?.details || data?.code || (typeof data === 'string' ? data.slice(0, 300) : '') || `HTTP ${res.status}`
      throw new AmazonAdsApiError(res.status, `Amazon Ads: ${msg}`)
    }
    return data as T
  }

  /** All pages of an SP v3 list endpoint. */
  async list<T = any>(path: string, vnd: string, key: string, filter: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = []
    let nextToken: string | undefined
    do {
      const res = await this.request<any>('POST', path, { vnd, body: { maxResults: 1000, ...filter, ...(nextToken ? { nextToken } : {}) } })
      out.push(...(res?.[key] ?? []))
      nextToken = res?.nextToken
    } while (nextToken)
    return out
  }
}

/** The store's connected client; throws when not connected or no profile is chosen yet. */
export async function amazonAdsClient(): Promise<AmazonAdsClient> {
  const cfg = await readAmazonAdsConfig()
  if (!cfg?.refresh_token || !cfg.profile_id) throw new IntegrationNotConnectedError(AMAZON_ADS_PROVIDER, await amazonAdsTenantKey())
  return new AmazonAdsClient(cfg.refresh_token, cfg.profile_id)
}

export interface AdsProfile {
  profileId: string
  name: string
  countryCode: string
  currencyCode: string
  type: string
}

export async function listProfiles(refreshToken: string): Promise<AdsProfile[]> {
  const c = new AmazonAdsClient(refreshToken, null)
  const rows = await c.request<any[]>('GET', '/v2/profiles', { profile: false })
  return (rows ?? []).map(p => ({
    profileId: String(p.profileId),
    name: String(p.accountInfo?.name ?? p.profileId),
    countryCode: String(p.countryCode ?? ''),
    currencyCode: String(p.currencyCode ?? 'INR'),
    type: String(p.accountInfo?.type ?? ''),
  }))
}

/** Problems in an SP v3 multi-status response ({ campaigns: { success, error } }). */
export function multiStatusErrors(res: any, key: string): string[] {
  return (res?.[key]?.error ?? []).flatMap((e: any) =>
    (e?.errors ?? []).map((x: any) => {
      const v = x?.errorValue ? Object.values(x.errorValue)[0] : null
      return String((v as any)?.message ?? x?.errorType ?? 'Amazon rejected the change')
    })
  )
}
