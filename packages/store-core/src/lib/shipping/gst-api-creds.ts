import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential } from '@/lib/tenant-registry'
import { decryptToken } from '@/lib/crypto/token-cipher'
import { queryOne } from '@/lib/shared/db'

// E-way bill and e-invoice (GSP / NIC) API credentials. The flagship uses the platform env under the
// platform GSTIN, as before. Every other store uses its own credentials (providers 'ewaybill' /
// 'einvoice' in tenant_integration_credentials) under its own business_gstin, and without them it
// cannot generate: it never falls back to the platform's account.

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export type GstApiProvider = 'ewaybill' | 'einvoice'
export const GST_API_PROVIDERS: GstApiProvider[] = ['ewaybill', 'einvoice']

export interface GstApiCreds {
  username: string
  password: string
  clientId: string
  clientSecret: string
  gstin: string
  baseUrl: string
  /** Token cache key: one per store and account. */
  cacheKey: string
}

export const GST_API_LABEL: Record<GstApiProvider, string> = { ewaybill: 'e-way bill', einvoice: 'e-invoice' }
const ENV_PREFIX: Record<GstApiProvider, string> = { ewaybill: 'EWAYBILL', einvoice: 'EINVOICE' }
export const GST_API_DEFAULT_BASE: Record<GstApiProvider, string> = {
  ewaybill: 'https://gst.gov.in/api',
  einvoice: 'https://einvoice1-sandbox.nic.in',
}

export class GstApiNotConnectedError extends Error {
  constructor(
    public provider: GstApiProvider,
    message = `Add your ${GST_API_LABEL[provider]} API credentials in Integrations`
  ) {
    super(message)
    this.name = 'GstApiNotConnectedError'
  }
}

/** The platform's env credentials (flagship only), or null when any is missing. */
export function envGstApiCreds(provider: GstApiProvider, env: Record<string, string | undefined> = process.env): GstApiCreds | null {
  const p = ENV_PREFIX[provider]
  const [clientId, clientSecret, username, password, gstin] = ['CLIENT_ID', 'CLIENT_SECRET', 'USERNAME', 'PASSWORD', 'GSTIN'].map(k => env[`${p}_${k}`])
  if (!clientId || !clientSecret || !username || !password || !gstin) return null
  return {
    clientId,
    clientSecret,
    username,
    password,
    gstin,
    baseUrl: env[`${p}_BASE_URL`] || GST_API_DEFAULT_BASE[provider],
    cacheKey: `env|${username}|${gstin}`,
  }
}

/** The current store's tenant id, or null on the flagship. */
export async function gstApiStore(): Promise<string | null> {
  const id = await resolveTenantId()
  return id && id !== PLATFORM_TENANT_ID ? id : null
}

/** A store's saved credential blob, or null. */
export async function readGstApiConfig(tenantId: string, provider: GstApiProvider): Promise<Record<string, string> | null> {
  const row = await getIntegrationCredential(tenantId, provider)
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc))
  } catch {
    return null
  }
}

export async function storeGstin(): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'business_gstin'`)
  const v = row?.value?.trim().toUpperCase()
  return v || null
}

/** Credentials for the current store. The flagship gets the env (null when unset: callers keep their
 * stub). A store gets its own; without them, or without a GSTIN, this throws GstApiNotConnectedError. */
export async function resolveGstApiCreds(provider: GstApiProvider): Promise<GstApiCreds | null> {
  const tenantId = await gstApiStore()
  if (!tenantId) return envGstApiCreds(provider)
  const cfg = await readGstApiConfig(tenantId, provider)
  if (!cfg?.username || !cfg.password || !cfg.client_id || !cfg.client_secret) throw new GstApiNotConnectedError(provider)
  const gstin = await storeGstin()
  if (!gstin) throw new GstApiNotConnectedError(provider, 'Add your GSTIN in Site Controls (business details) first')
  return {
    username: cfg.username,
    password: cfg.password,
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    gstin,
    baseUrl: cfg.base_url || GST_API_DEFAULT_BASE[provider],
    cacheKey: `${tenantId}|${cfg.username}|${gstin}`,
  }
}

/** A store-supplied API base URL: https, a public host name, no credentials or query. */
export function validGstBaseUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return false
  return !/(^|\.)(localhost|local|internal|svc|cluster\.local)$/.test(host)
}
