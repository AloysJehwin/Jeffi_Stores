import { getCurrentTenant } from '../tenant-context'
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

/** Decrypt + parse a tenant's stored credential blob for a provider, or null if not connected. */
async function tenantConfig(provider: string): Promise<Record<string, any> | null> {
  const tenant = getCurrentTenant()
  if (!tenant) return null
  const row = await getIntegrationCredential(tenant.tenantId, provider)
  if (!row || row.status !== 'connected') return null
  try {
    return JSON.parse(decryptToken(row.config_enc))
  } catch {
    return null
  }
}

/** Resolve Google Merchant credentials: the tenant's own if connected. In a tenant context an
 * unconnected provider throws — it never falls back to the platform account. */
export async function resolveGoogleMerchantCreds(): Promise<GoogleMerchantCreds> {
  const tenant = getCurrentTenant()
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

/** Resolve Amazon SP-API credentials: the tenant's own if connected. In a tenant context an
 * unconnected provider throws — it never falls back to the platform account. */
export async function resolveAmazonCreds(): Promise<AmazonCreds> {
  const tenant = getCurrentTenant()
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
