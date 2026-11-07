import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { createSign } from 'crypto'
import { resolveTenant, resolveTenantId } from '@/lib/tenancy/tenant-context'
import { controlPlanePool, getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '../tenant-registry'
import { decryptToken, encryptToken } from '../crypto/token-cipher'
import type { MarketplaceChannel, MarketplaceMode } from '@/lib/marketplace/types'
import { loadGoogleServiceAccount } from '@/lib/shared/google-credentials'

// Runtime credential resolution for external integrations. The rule is uniform: if there is a
// tenant in the AsyncLocalStorage context (a tenant-scoped request/job), use THAT tenant's
// stored+encrypted credentials — and if the tenant has NOT connected the provider, fail loudly.
// A tenant must NEVER fall through to the platform env creds (Jeffi's own Google/Amazon account),
// or an unconnected tenant would silently sync into Jeffi's Merchant Center / Seller account.
// The flagship (no tenant) connects through the same gear; its rows sit under the platform tenant
// id and are used first, with the env creds only as its fallback.
// The platform env fallback is reachable only off-tenant (getCurrentTenant() === null), i.e.
// Jeffi's own single-tenant use. This mirrors social/publisher.ts, which uses jeffiCreds() only
// when post.tenant_id === null.

export class IntegrationNotConnectedError extends Error {
  constructor(
    public provider: string,
    tenantId: string
  ) {
    super(`Integration '${provider}' is not connected for tenant ${tenantId}`)
    this.name = 'IntegrationNotConnectedError'
  }
}

export interface GoogleMerchantCreds {
  // Service-account creds; empty when the tenant connected with Google sign-in (refreshToken).
  clientEmail: string
  privateKey: string
  refreshToken?: string
  /** The store's own OAuth client the refresh token was issued to; the platform's when unset. */
  oauthClient?: GoogleOAuthApp
  merchantId: string
  // Merchant API primary API data source (`accounts/{id}/dataSources/{id}` or the bare id); found or created when unset.
  dataSource?: string
}

export interface AmazonCreds {
  clientId: string
  clientSecret: string
  refreshToken: string
  sellerId: string
  marketplaceId: string
  /** The store's chosen SP-API host (region / sandbox); AMAZON_SP_API_HOST when unset. */
  spApiHost?: string
}

/** Decrypt + parse a stored credential blob for a provider under a specific tenant, or null. */
async function tenantConfigFor(tenantId: string, provider: string): Promise<Record<string, any> | null> {
  const row = await getIntegrationCredential(tenantId, provider)
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc))
  } catch {
    return null
  }
}

/** The current store's stored credential blob for a provider (the flagship's under the platform
 * tenant id), or null. The flagship falls back to env only when it has none stored. */
async function tenantConfig(provider: string): Promise<Record<string, any> | null> {
  const tenant = await resolveTenant()
  if (tenant) return tenantConfigFor(tenant.tenantId, provider)
  // The flagship's own connection, if any; an unreachable store falls back to env rather than failing.
  return tenantConfigFor(PLATFORM_TENANT_ID, provider).catch(() => null)
}

/** Resolve Google Merchant credentials: the tenant's own if connected. In a tenant context an
 * unconnected provider throws — it never falls back to the platform account. */
export async function resolveGoogleMerchantCreds(): Promise<GoogleMerchantCreds> {
  const tenant = await resolveTenant()
  const cfg = await tenantConfig('google_merchant')
  if (cfg?.private_key && cfg?.client_email && cfg?.merchant_id) {
    return {
      clientEmail: cfg.client_email,
      privateKey: cfg.private_key.includes('\\n') ? cfg.private_key.replace(/\\n/g, '\n') : cfg.private_key,
      merchantId: String(cfg.merchant_id),
      dataSource: cfg.data_source ? String(cfg.data_source) : undefined,
    }
  }
  if (cfg?.oauth_refresh_token && cfg?.merchant_id) {
    const oauthClient = googleOAuthAppFrom(cfg)
    return {
      clientEmail: '',
      privateKey: '',
      refreshToken: String(cfg.oauth_refresh_token),
      ...(oauthClient ? { oauthClient } : {}),
      merchantId: String(cfg.merchant_id),
      dataSource: cfg.data_source ? String(cfg.data_source) : undefined,
    }
  }
  if (tenant) throw new IntegrationNotConnectedError('google_merchant', tenant.tenantId)
  // Off-tenant only (Jeffi's own): env service-account + GMC_MERCHANT_ID; without a key the flagship
  // is not connected, like a store, rather than failing on a missing file.
  let sa: ReturnType<typeof loadGoogleServiceAccount>
  try {
    sa = loadGoogleServiceAccount()
  } catch {
    throw new IntegrationNotConnectedError('google_merchant', PLATFORM_TENANT_ID)
  }
  return {
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
    merchantId: process.env.GMC_MERCHANT_ID || '5762156822',
    dataSource: process.env.GMC_DATA_SOURCE || undefined,
  }
}

/** A store's own Google OAuth client (the refresh token must have been issued to it). */
export interface GoogleOAuthApp {
  clientId: string
  clientSecret: string
}

/** The store's own client from a stored blob's client_id/client_secret, or undefined. */
export function googleOAuthAppFrom(cfg: Record<string, any> | null | undefined): GoogleOAuthApp | undefined {
  return cfg?.client_id && cfg?.client_secret ? { clientId: String(cfg.client_id), clientSecret: String(cfg.client_secret) } : undefined
}

/** Exchange a refresh token for an access token, with the store's own OAuth client when given, else
 * the platform's. `scope` is what Google reports as granted to the token (space-separated), when it says. */
export async function googleOAuthAccessToken(
  refreshToken: string,
  what = 'Google',
  app?: GoogleOAuthApp | null
): Promise<{ token: string; expiresInSec: number; scope?: string }> {
  const clientId = app?.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = app?.clientId ? app.clientSecret : process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || 'token_refresh_failed'
    throw new Error(`${what} token refresh failed: ${reason}`)
  }
  return {
    token: String(data.access_token),
    expiresInSec: Number(data.expires_in) || 3600,
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

const saTokenCache = new Map<string, { token: string; expiresAt: number }>()

/** Access token for a Google service account (JWT bearer grant) with the given scope. Cached per
 * account+scope until a minute before expiry. Same flow the Merchant sync uses for the flagship. */
export async function googleServiceAccountAccessToken(
  clientEmail: string,
  privateKey: string,
  scope: string
): Promise<{ token: string; expiresInSec: number }> {
  const key = `${clientEmail}|${scope}`
  const cached = saTokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return { token: cached.token, expiresInSec: Math.floor((cached.expiresAt - Date.now()) / 1000) }
  }
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ iss: clientEmail, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  ).toString('base64url')
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const jwt = `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    throw new Error(`Google service account token failed: ${data?.error_description || data?.error || res.status}`)
  }
  const expiresInSec = Number(data.expires_in) || 3600
  saTokenCache.set(key, { token: String(data.access_token), expiresAt: Date.now() + expiresInSec * 1000 })
  return { token: String(data.access_token), expiresInSec }
}

export const GOOGLE_SHEETS_SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file'

export interface GoogleSheetsCreds {
  accessToken: string
  spreadsheetId: string | null
}

/** Exchange a tenant's stored Google Sheets refresh token for a short-lived access token, plus
 * the tenant's configured spreadsheet id. Distinct provider from google_merchant so connecting
 * Sheets (spreadsheets.readonly) does not clobber the Merchant Center Content-API token. Pass an
 * explicit `tenantId` for callers off the ALS context (e.g. the flagship admin, keyed to the
 * platform sentinel); when omitted, the current ALS tenant is used. A connected provider is
 * required either way — this never falls back to a platform Google account. */
export async function resolveGoogleSheetsCreds(tenantId?: string): Promise<GoogleSheetsCreds> {
  const id = tenantId ?? (await resolveTenantId())
  const cfg = id ? await tenantConfigFor(id, 'google_sheets') : null
  const spreadsheetId = cfg?.spreadsheet_id ? String(cfg.spreadsheet_id) : null
  // A service account the store shared its sheet with.
  if (cfg?.client_email && cfg?.private_key) {
    const key = String(cfg.private_key).replace(/\\n/g, '\n')
    const { token } = await googleServiceAccountAccessToken(String(cfg.client_email), key, GOOGLE_SHEETS_SCOPES)
    return { accessToken: token, spreadsheetId }
  }
  const refreshToken = cfg?.oauth_refresh_token
  if (refreshToken) {
    const { token } = await googleOAuthAccessToken(String(refreshToken), 'Google Sheets', googleOAuthAppFrom(cfg))
    return { accessToken: token, spreadsheetId }
  }
  throw new IntegrationNotConnectedError('google_sheets', id ?? 'platform')
}

/** Resolve Amazon SP-API credentials: the tenant's own if connected. In a tenant context an
 * unconnected provider throws — it never falls back to the platform account. */
export async function resolveAmazonCreds(): Promise<AmazonCreds> {
  const tenant = await resolveTenant()
  const cfg = await tenantConfig('amazon_seller')
  if (cfg?.refresh_token && cfg?.client_id) {
    return {
      clientId: cfg.client_id,
      clientSecret: cfg.client_secret ?? '',
      refreshToken: cfg.refresh_token,
      sellerId: cfg.seller_id ?? '',
      marketplaceId: cfg.marketplace_id ?? (process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV'),
      ...(cfg.sp_api_host ? { spApiHost: String(cfg.sp_api_host) } : {}),
    }
  }
  if (tenant) throw new IntegrationNotConnectedError('amazon_seller', tenant.tenantId)
  return {
    clientId: process.env.AMAZON_LWA_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN || '',
    sellerId: process.env.AMAZON_SELLER_ID || '',
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV',
  }
}

/** Resolve the Delhivery API token: the tenant's own if connected, else the platform env token.
 * Delhivery DIVERGES from the Google/Amazon rule — it MUST fall back to the platform token, because
 * the platform resells Delhivery on behalf of tenants who have not brought their own account. Pass
 * an explicit `tenantId` for callers that run off the ALS context (e.g. the sync-statuses cron);
 * when omitted, the current ALS tenant is used. */
export async function resolveDelhiveryToken(tenantId?: string): Promise<string> {
  const id = tenantId ?? (await resolveTenantId())
  if (id) {
    const cfg = await tenantConfigFor(id, 'delhivery')
    if (cfg?.token) return String(cfg.token)
  }
  return process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_TOKEN || ''
}

/** True iff the tenant has a connected, non-empty Delhivery token of their own (ignoring the platform
 * env fallback). Mirrors RazorpayCreds.isOwn for the own_delhivery toggle guard: enabling own-Delhivery
 * without a connected token would leave the tenant unable to ship. */
export async function hasOwnDelhiveryToken(tenantId: string): Promise<boolean> {
  if (!tenantId) return false
  const cfg = await tenantConfigFor(tenantId, 'delhivery').catch(() => null)
  return !!cfg?.token
}

export interface RazorpayCreds {
  key_id: string
  key_secret: string
  webhook_secret?: string
  isOwn: boolean
}

/** The store's saved Razorpay keys whatever its collection mode, or null. For callers that manage or
 * verify the keys themselves; payments go through resolveRazorpayCreds. */
export async function storedRazorpayKeys(tenantId: string): Promise<Omit<RazorpayCreds, 'isOwn'> | null> {
  const cfg = await tenantConfigFor(tenantId, 'razorpay')
  if (!cfg?.key_id || !cfg?.key_secret) return null
  return {
    key_id: String(cfg.key_id),
    key_secret: String(cfg.key_secret),
    webhook_secret: cfg.webhook_secret ? String(cfg.webhook_secret) : undefined,
  }
}

const OWN_RZP_TTL_MS = 30_000
const ownRzp = new Map<string, { own: boolean; at: number }>()

// tenants.own_razorpay, cached briefly. Throws when it can't be read: guessing either way would
// collect into the wrong account.
async function collectsOnOwnAccount(tenantId: string): Promise<boolean> {
  if (tenantId === PLATFORM_TENANT_ID) return true
  const hit = ownRzp.get(tenantId)
  if (hit && Date.now() - hit.at < OWN_RZP_TTL_MS) return hit.own
  const { rows } = await controlPlanePool().query(`SELECT own_razorpay FROM tenants WHERE id = $1`, [tenantId])
  const own = rows[0]?.own_razorpay === true
  ownRzp.set(tenantId, { own, at: Date.now() })
  return own
}

/** Resolve Razorpay API credentials: the tenant's own keys when it collects on its own account
 * (tenants.own_razorpay) and has saved them, else the platform env keys. Like Delhivery (and unlike
 * Google/Amazon) this FALLS BACK to the platform account, because the platform collects on behalf of
 * every other tenant. Keys saved while the store is on the platform account are ignored, so they can't
 * divert payments away from Route. `isOwn` tells callers whether a tenant account is in use. Pass an
 * explicit `tenantId` for callers off the ALS context; when omitted, the current ALS tenant is used. */
export async function resolveRazorpayCreds(tenantId?: string): Promise<RazorpayCreds> {
  const id = tenantId ?? (await resolveTenantId())
  if (id && (await collectsOnOwnAccount(id))) {
    const keys = await storedRazorpayKeys(id)
    if (keys) return { ...keys, isOwn: true }
  }
  return {
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || undefined,
    isOwn: false,
  }
}

// ── Marketplaces (Myntra, AJIO) ──────────────────────────────────────────────
// The seller's own partner credentials only; there is no platform account to fall back to. The
// flagship's sit under the platform tenant id. The blob also carries the push token we gave the
// marketplace (the previous one stays valid for 24 h after a rotate) and an optional IP allowlist.

export interface MarketplaceCreds {
  mode: MarketplaceMode
  fields: Record<string, string>
  push_token?: string
  push_token_prev?: string
  push_token_rotated_at?: string
  ip_allowlist?: string[]
  endpoints?: Record<string, string>
}

export const MARKETPLACE_PROVIDER: Record<MarketplaceChannel, string> = { myntra: 'myntra_seller', ajio: 'ajio_seller' }
const MARKETPLACE_MODES: MarketplaceMode[] = ['live', 'sandbox', 'mock']

const strRecord = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (x != null) out[k] = String(x)
  return out
}

function toMarketplaceCreds(cfg: Record<string, any>): MarketplaceCreds {
  const creds: MarketplaceCreds = {
    mode: MARKETPLACE_MODES.includes(cfg.mode) ? cfg.mode : 'live',
    fields: strRecord(cfg.fields),
  }
  if (cfg.push_token) creds.push_token = String(cfg.push_token)
  if (cfg.push_token_prev) creds.push_token_prev = String(cfg.push_token_prev)
  if (cfg.push_token_rotated_at) creds.push_token_rotated_at = String(cfg.push_token_rotated_at)
  if (Array.isArray(cfg.ip_allowlist)) creds.ip_allowlist = cfg.ip_allowlist.map(String).filter(Boolean)
  if (cfg.endpoints) creds.endpoints = strRecord(cfg.endpoints)
  return creds
}

const marketplaceTenant = async (tenantId?: string) => tenantId ?? (await resolveTenantId()) ?? PLATFORM_TENANT_ID

/** The store's marketplace credentials, or null when it has not connected the marketplace. */
export async function resolveMarketplaceCreds(channel: MarketplaceChannel, tenantId?: string): Promise<MarketplaceCreds | null> {
  const cfg = await tenantConfigFor(await marketplaceTenant(tenantId), MARKETPLACE_PROVIDER[channel])
  return cfg ? toMarketplaceCreds(cfg) : null
}

export async function saveMarketplaceCreds(channel: MarketplaceChannel, creds: MarketplaceCreds, tenantId?: string): Promise<void> {
  const clean = toMarketplaceCreds(creds as unknown as Record<string, any>)
  await saveIntegrationCredential({
    tenantId: await marketplaceTenant(tenantId),
    provider: MARKETPLACE_PROVIDER[channel],
    label: channel === 'myntra' ? 'Myntra' : 'AJIO',
    configEnc: encryptToken(JSON.stringify(clean)),
    meta: { mode: clean.mode, has_push_token: !!clean.push_token, push_token_rotated_at: clean.push_token_rotated_at ?? null },
  })
}

export async function deleteMarketplaceCreds(channel: MarketplaceChannel, tenantId?: string): Promise<void> {
  await deleteIntegrationCredential(await marketplaceTenant(tenantId), MARKETPLACE_PROVIDER[channel])
}
