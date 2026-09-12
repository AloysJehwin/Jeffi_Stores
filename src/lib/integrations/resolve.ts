import { resolveTenant, resolveTenantId } from '../tenant-context'
import { getIntegrationCredential } from '../tenant-registry'
import { decryptToken } from '../crypto/token-cipher'
import { loadGoogleServiceAccount } from '../google-credentials'

// Runtime credential resolution for external integrations. The rule is uniform: if there is a
// tenant in the AsyncLocalStorage context (a tenant-scoped request/job), use THAT tenant's
// stored+encrypted credentials — and if the tenant has NOT connected the provider, fail loudly.
// A tenant must NEVER fall through to the platform env creds (Jeffi's own Google/Amazon account),
// or an unconnected tenant would silently sync into Jeffi's Merchant Center / Seller account.
// The platform env fallback is reachable only off-tenant (getCurrentTenant() === null), i.e.
// Jeffi's own single-tenant use. This mirrors social/publisher.ts, which uses jeffiCreds() only
// when post.tenant_id === null.

export class IntegrationNotConnectedError extends Error {
  constructor(public provider: string, tenantId: string) {
    super(`Integration '${provider}' is not connected for tenant ${tenantId}`)
    this.name = 'IntegrationNotConnectedError'
  }
}

export interface GoogleMerchantCreds {
  clientEmail: string
  privateKey: string
  merchantId: string
}

export interface AmazonCreds {
  clientId: string
  clientSecret: string
  refreshToken: string
  sellerId: string
  marketplaceId: string
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

/** Decrypt + parse the current ALS tenant's stored credential blob for a provider, or null. */
async function tenantConfig(provider: string): Promise<Record<string, any> | null> {
  const tenant = await resolveTenant()
  if (!tenant) return null
  return tenantConfigFor(tenant.tenantId, provider)
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
    }
  }
  if (tenant) throw new IntegrationNotConnectedError('google_merchant', tenant.tenantId)
  // Off-tenant only (Jeffi's own): env service-account + GMC_MERCHANT_ID.
  const sa = loadGoogleServiceAccount()
  return {
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
    merchantId: process.env.GMC_MERCHANT_ID || '5762156822',
  }
}

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
  const id = tenantId ?? await resolveTenantId()
  const cfg = id ? await tenantConfigFor(id, 'google_sheets') : null
  const refreshToken = cfg?.oauth_refresh_token
  if (refreshToken) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('Google OAuth not configured')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: String(refreshToken), grant_type: 'refresh_token',
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.access_token) {
      const reason = data?.error_description || data?.error || 'token_refresh_failed'
      throw new Error(`Google Sheets token refresh failed: ${reason}`)
    }
    return { accessToken: String(data.access_token), spreadsheetId: cfg?.spreadsheet_id ? String(cfg.spreadsheet_id) : null }
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
  const id = tenantId ?? await resolveTenantId()
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

/** Resolve Razorpay API credentials: the tenant's own if they have connected them, else the
 * platform env keys. Like Delhivery (and unlike Google/Amazon) this FALLS BACK to the platform
 * account, because the platform collects on behalf of every tenant who has not brought their own
 * Razorpay account (own_razorpay). `isOwn` tells callers whether a tenant account is in use — e.g.
 * the webhook/verify Route split short-circuits when a tenant collects directly. Pass an explicit
 * `tenantId` for callers off the ALS context; when omitted, the current ALS tenant is used. */
export async function resolveRazorpayCreds(tenantId?: string): Promise<RazorpayCreds> {
  const id = tenantId ?? await resolveTenantId()
  if (id) {
    const cfg = await tenantConfigFor(id, 'razorpay')
    if (cfg?.key_id && cfg?.key_secret) {
      return {
        key_id: String(cfg.key_id),
        key_secret: String(cfg.key_secret),
        webhook_secret: cfg.webhook_secret ? String(cfg.webhook_secret) : undefined,
        isOwn: true,
      }
    }
  }
  return {
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || undefined,
    isOwn: false,
  }
}
