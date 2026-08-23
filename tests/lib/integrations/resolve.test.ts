/**
 * Tests for src/lib/integrations/resolve.ts — the tenant-or-env credential resolver.
 *
 * The rule pinned here is the one that keeps tenants isolated AND keeps single-tenant (Jeffi)
 * behaviour unchanged: when a tenant is in the AsyncLocalStorage context AND has a 'connected'
 * credential row, use THAT tenant's decrypted creds; otherwise fall back to the platform env.
 * A wrong answer here would either leak Jeffi's account to a tenant or a tenant's to Jeffi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Seams: tenant context, the credential store, decryption, and the env service account.
// ---------------------------------------------------------------------------
const ctx = { getCurrentTenant: vi.fn() }
vi.mock('@/lib/tenant-context', () => ctx)

const registry = { getIntegrationCredential: vi.fn() }
vi.mock('@/lib/tenant-registry', () => registry)

// decryptToken is a passthrough here — the row's config_enc is already plain JSON in tests.
vi.mock('@/lib/crypto/token-cipher', () => ({
  decryptToken: (s: string) => s,
}))

const google = { loadGoogleServiceAccount: vi.fn() }
vi.mock('@/lib/google-credentials', () => google)

// A 'connected' credential row whose config_enc (after passthrough decrypt) is plain JSON.
function credRow(config: Record<string, any>, status = 'connected') {
  return { status, config_enc: JSON.stringify(config) } as any
}

describe('integrations/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no tenant in context (single-tenant / platform path).
    ctx.getCurrentTenant.mockReturnValue(null)
    registry.getIntegrationCredential.mockResolvedValue(null)
    google.loadGoogleServiceAccount.mockReturnValue({
      client_email: 'platform@jeffi.iam.gserviceaccount.com',
      private_key: 'PLATFORM_PK',
    })
    // Platform env fallbacks.
    process.env.GMC_MERCHANT_ID = 'env-merchant-1'
    process.env.AMAZON_LWA_CLIENT_ID = 'env-cid'
    process.env.AMAZON_LWA_CLIENT_SECRET = 'env-csecret'
    process.env.AMAZON_LWA_REFRESH_TOKEN = 'env-rtok'
    process.env.AMAZON_SELLER_ID = 'env-seller'
    process.env.AMAZON_MARKETPLACE_ID = 'env-marketplace'
  })

  describe('resolveGoogleMerchantCreds', () => {
    it('falls back to the platform env service account when there is no tenant', async () => {
      const { resolveGoogleMerchantCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveGoogleMerchantCreds()
      expect(creds).toEqual({
        clientEmail: 'platform@jeffi.iam.gserviceaccount.com',
        privateKey: 'PLATFORM_PK',
        merchantId: 'env-merchant-1',
      })
      // No tenant -> never touched the credential store.
      expect(registry.getIntegrationCredential).not.toHaveBeenCalled()
    })

    it("uses the TENANT's connected google_merchant creds (merchantId from the row, not env)", async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(credRow({
        client_email: 'tenant@acme.iam.gserviceaccount.com',
        private_key: 'TENANT_PK',
        merchant_id: 'tenant-merchant-99',
      }))
      const { resolveGoogleMerchantCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveGoogleMerchantCreds()
      expect(registry.getIntegrationCredential).toHaveBeenCalledWith('t-1', 'google_merchant')
      expect(creds).toEqual({
        clientEmail: 'tenant@acme.iam.gserviceaccount.com',
        privateKey: 'TENANT_PK',
        merchantId: 'tenant-merchant-99',
      })
      // Tenant creds win — the platform env service account is never loaded.
      expect(google.loadGoogleServiceAccount).not.toHaveBeenCalled()
    })

    it('un-escapes a private_key stored with literal "\\n" sequences', async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(credRow({
        client_email: 'tenant@acme.iam.gserviceaccount.com',
        private_key: '-----BEGIN-----\\nLINE\\n-----END-----',
        merchant_id: 'tenant-merchant-99',
      }))
      const { resolveGoogleMerchantCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveGoogleMerchantCreds()
      expect(creds.privateKey).toBe('-----BEGIN-----\nLINE\n-----END-----')
    })

    it('falls back to env when the tenant has no google_merchant row', async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(null)
      const { resolveGoogleMerchantCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveGoogleMerchantCreds()
      expect(creds.merchantId).toBe('env-merchant-1')
      expect(creds.clientEmail).toBe('platform@jeffi.iam.gserviceaccount.com')
    })

    it('falls back to env when the tenant row is not connected', async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(credRow({
        client_email: 'x', private_key: 'y', merchant_id: 'z',
      }, 'disconnected'))
      const { resolveGoogleMerchantCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveGoogleMerchantCreds()
      expect(creds.merchantId).toBe('env-merchant-1')
    })
  })

  describe('resolveAmazonCreds', () => {
    it('falls back to the platform env creds when there is no tenant', async () => {
      const { resolveAmazonCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveAmazonCreds()
      expect(creds).toEqual({
        clientId: 'env-cid',
        clientSecret: 'env-csecret',
        refreshToken: 'env-rtok',
        sellerId: 'env-seller',
        marketplaceId: 'env-marketplace',
      })
      expect(registry.getIntegrationCredential).not.toHaveBeenCalled()
    })

    it("uses the TENANT's connected amazon_seller creds", async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(credRow({
        client_id: 'tenant-cid',
        client_secret: 'tenant-csecret',
        refresh_token: 'tenant-rtok',
        seller_id: 'tenant-seller',
        marketplace_id: 'tenant-marketplace',
      }))
      const { resolveAmazonCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveAmazonCreds()
      expect(registry.getIntegrationCredential).toHaveBeenCalledWith('t-1', 'amazon_seller')
      expect(creds).toEqual({
        clientId: 'tenant-cid',
        clientSecret: 'tenant-csecret',
        refreshToken: 'tenant-rtok',
        sellerId: 'tenant-seller',
        marketplaceId: 'tenant-marketplace',
      })
    })

    it('defaults a tenant marketplace_id to env when the row omits it', async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(credRow({
        client_id: 'tenant-cid',
        refresh_token: 'tenant-rtok',
      }))
      const { resolveAmazonCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveAmazonCreds()
      expect(creds.clientId).toBe('tenant-cid')
      expect(creds.marketplaceId).toBe('env-marketplace')
      // Missing optional fields degrade to empty strings, not env.
      expect(creds.clientSecret).toBe('')
      expect(creds.sellerId).toBe('')
    })

    it('falls back to env when the tenant has no amazon_seller row', async () => {
      ctx.getCurrentTenant.mockReturnValue({ tenantId: 't-1' })
      registry.getIntegrationCredential.mockResolvedValue(null)
      const { resolveAmazonCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveAmazonCreds()
      expect(creds.clientId).toBe('env-cid')
      expect(creds.marketplaceId).toBe('env-marketplace')
    })
  })
})
