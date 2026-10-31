import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { fetchWithRetry } from '@/lib/channels/ratelimit'

// Meta Marketing API (ad accounts, campaigns, insights) and the Conversions API. The same Meta app
// as social posting (META_APP_ID / META_APP_SECRET) with ads scopes, stored in its own credential
// row 'meta_ads' so connecting ads never replaces the Page token used for posting. A long-lived
// user token lasts about 60 days; a system user token (entered by hand) does not expire.

export const META_ADS_PROVIDER = 'meta_ads'
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
export const META_ADS_SCOPES = ['ads_read', 'ads_management', 'business_management']

export interface MetaAdsConfig {
  access_token: string
  token_expires_at?: string | null
  ad_account_id?: string
  ad_account_name?: string
  currency?: string
  pixel_id?: string
  /** Conversions API token from Events Manager; the access token is used when absent. */
  capi_token?: string
  connected_via: 'oauth' | 'manual'
}

export class MetaApiError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
    public code?: number
  ) {
    super(message)
    this.name = 'MetaApiError'
  }
}

export const metaEnvReady = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET)

export async function metaAdsTenantKey(): Promise<string> {
  return (await resolveTenantId()) ?? PLATFORM_TENANT_ID
}

export async function readMetaAdsConfig(tenantKey?: string): Promise<MetaAdsConfig | null> {
  const row = await getIntegrationCredential(tenantKey ?? (await metaAdsTenantKey()), META_ADS_PROVIDER).catch(
    () => null
  )
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc)) as MetaAdsConfig
  } catch {
    return null
  }
}

export async function saveMetaAdsConfig(tenantKey: string, cfg: MetaAdsConfig): Promise<void> {
  await saveIntegrationCredential({
    tenantId: tenantKey,
    provider: META_ADS_PROVIDER,
    label: cfg.ad_account_name ? `Meta Ads (${cfg.ad_account_name})` : 'Meta Ads',
    configEnc: encryptToken(JSON.stringify(cfg)),
    meta: {
      ad_account_id: cfg.ad_account_id ?? null,
      pixel_id: cfg.pixel_id ?? null,
      connected_via: cfg.connected_via,
    },
    expiresAt: cfg.token_expires_at ? new Date(cfg.token_expires_at) : null,
  })
}

export async function disconnectMetaAds(tenantKey: string): Promise<void> {
  await deleteIntegrationCredential(tenantKey, META_ADS_PROVIDER)
}

/** Meta budgets and spend caps are in the currency's minor unit (paise for INR). */
export const toMinor = (v: number) => Math.round(v * 100)
export const fromMinor = (v: unknown) => (v == null || v === '' ? null : Number(v) / 100)

export class MetaGraph {
  constructor(private token: string) {}

  async get<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams({ ...params, access_token: this.token })
    return this.handle<T>(await fetchWithRetry(`${GRAPH}/${path}?${qs}`, { method: 'GET' }))
  }

  async post<T = any>(path: string, params: Record<string, unknown>): Promise<T> {
    const body = new URLSearchParams({ access_token: this.token })
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) body.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    return this.handle<T>(
      await fetchWithRetry(`${GRAPH}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    )
  }

  /** All pages of an edge (follows paging.next). */
  async all<T = any>(path: string, params: Record<string, string> = {}, max = 5000): Promise<T[]> {
    const out: T[] = []
    let res = await this.get<any>(path, { limit: '500', ...params })
    out.push(...(res?.data ?? []))
    while (res?.paging?.next && out.length < max) {
      res = await this.handle<any>(await fetchWithRetry(res.paging.next, { method: 'GET' }))
      out.push(...(res?.data ?? []))
    }
    return out
  }

  private async handle<T>(res: Response): Promise<T> {
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      const e = json?.error ?? {}
      throw new MetaApiError(res.status, `Meta: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`, e.code)
    }
    return json as T
  }
}

export async function metaAdsGraph(): Promise<{ graph: MetaGraph; cfg: MetaAdsConfig & { ad_account_id: string } }> {
  const cfg = await readMetaAdsConfig()
  if (!cfg?.access_token || !cfg.ad_account_id)
    throw new IntegrationNotConnectedError(META_ADS_PROVIDER, await metaAdsTenantKey())
  return { graph: new MetaGraph(cfg.access_token), cfg: cfg as MetaAdsConfig & { ad_account_id: string } }
}

export interface AdAccount {
  id: string
  name: string
  currency: string
  status: number
}

export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const rows = await new MetaGraph(token).all<any>('me/adaccounts', { fields: 'id,name,currency,account_status' })
  return rows.map(a => ({
    id: String(a.id),
    name: String(a.name ?? a.id),
    currency: String(a.currency ?? 'INR'),
    status: Number(a.account_status ?? 0),
  }))
}
