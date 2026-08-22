import { getCurrentTenant } from '../tenant-context'
import { getIntegrationCredential } from '../tenant-registry'
import { decryptToken } from '../crypto/token-cipher'
import { loadGoogleServiceAccount } from '../google-credentials'

// Runtime credential resolution for external integrations. The rule is uniform: if there is a
// tenant in the AsyncLocalStorage context (a tenant-scoped request/job), use THAT tenant's
// stored+encrypted credentials; otherwise fall back to the platform env vars (Jeffi's own
// account). This mirrors how getPool()/S3 already scope by getCurrentTenant(), so existing
// single-tenant (Jeffi) behavior is unchanged when no tenant is set.

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

/** Resolve Google Merchant credentials: tenant's own if connected, else platform env. */
export async function resolveGoogleMerchantCreds(): Promise<GoogleMerchantCreds> {
  const cfg = await tenantConfig('google_merchant')
  if (cfg?.private_key && cfg?.client_email && cfg?.merchant_id) {
    return {
      clientEmail: cfg.client_email,
      privateKey: cfg.private_key.includes('\\n') ? cfg.private_key.replace(/\\n/g, '\n') : cfg.private_key,
      merchantId: String(cfg.merchant_id),
    }
  }
  // Platform fallback (Jeffi's own): env service-account + GMC_MERCHANT_ID.
  const sa = loadGoogleServiceAccount()
  return {
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
    merchantId: process.env.GMC_MERCHANT_ID || '5762156822',
  }
}

/** Resolve Amazon SP-API credentials: tenant's own if connected, else platform env. */
export async function resolveAmazonCreds(): Promise<AmazonCreds> {
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
  return {
    clientId: process.env.AMAZON_LWA_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN || '',
    sellerId: process.env.AMAZON_SELLER_ID || '',
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV',
  }
}
