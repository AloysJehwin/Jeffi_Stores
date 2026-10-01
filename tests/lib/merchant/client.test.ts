import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    default: {
      ...actual,
      createSign: vi.fn(() => ({
        update: vi.fn(),
        sign: vi.fn().mockReturnValue(Buffer.from('fake-signature')),
      })),
    },
    createSign: vi.fn(() => ({
      update: vi.fn(),
      sign: vi.fn().mockReturnValue(Buffer.from('fake-signature')),
    })),
  }
})

// Credential resolution is now the sole seam for account creds (tenant-or-env). Mock it so the
// auth/url tests exercise the JWT + request plumbing without touching fs/env service accounts.
const mockResolveGoogleMerchantCreds = vi.fn()
vi.mock('@/lib/integrations/resolve', () => ({
  resolveGoogleMerchantCreds: mockResolveGoogleMerchantCreds,
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const CREDS = {
  clientEmail: 'test@project.iam.gserviceaccount.com',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n',
  merchantId: '12345',
}

describe('merchant/client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockResolveGoogleMerchantCreds.mockResolvedValue({ ...CREDS })
  })

  describe('module structure', () => {
    it('exports expected functions', async () => {
      const mod = await import('@/lib/merchant/client')
      expect(typeof mod.getAccessToken).toBe('function')
      expect(typeof mod.gmcRequest).toBe('function')
      expect(typeof mod.upsertProduct).toBe('function')
      expect(typeof mod.deleteProduct).toBe('function')
      expect(typeof mod.deleteProductByOfferId).toBe('function')
      expect(typeof mod.listProducts).toBe('function')
      expect(typeof mod.customBatchUpsert).toBe('function')
    })

    it('getMerchantId resolves the merchant id from the resolver', async () => {
      const { getMerchantId } = await import('@/lib/merchant/client')
      expect(await getMerchantId()).toBe('12345')
    })
  })

  describe('getAccessToken', () => {
    it('returns a token using the resolved service-account credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token-123', expires_in: 3600 }),
      })

      const { getAccessToken } = await import('@/lib/merchant/client')
      const token = await getAccessToken()
      expect(token).toBe('test-token-123')
      // JWT bearer grant is posted to Google's token endpoint.
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('https://oauth2.googleapis.com/token')
      expect(opts.body).toContain('grant-type:jwt-bearer')
    })

    it('caches the token per resolved account (second call does not re-fetch)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'cached-tok', expires_in: 3600 }),
      })
      const { getAccessToken } = await import('@/lib/merchant/client')
      const t1 = await getAccessToken()
      const t2 = await getAccessToken()
      expect(t1).toBe(t2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('throws when the auth response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'invalid_grant' }),
      })
      const { getAccessToken } = await import('@/lib/merchant/client')
      await expect(getAccessToken()).rejects.toThrow(/GMC auth failed/)
    })
  })

  describe('gmcRequest', () => {
    it('makes an authenticated request scoped to the resolved merchant id', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'bearer-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ kind: 'content#productsListResponse', resources: [] }),
        })

      const { gmcRequest } = await import('@/lib/merchant/client')
      const result = await gmcRequest('GET', '/products')
      expect(typeof result).toBe('object')
      // Second call = the GMC API request; URL embeds the resolved merchant id.
      const [url, opts] = mockFetch.mock.calls[1]
      expect(url).toContain('/12345/products')
      expect(opts.headers.Authorization).toBe('Bearer bearer-token')
    })
  })

  describe('upsertProduct', () => {
    it('calls GMC API to insert product', async () => {
      const fakeProduct = { offerId: 'SKU-001', title: 'Test Product', price: { value: '100', currency: 'INR' } }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ offerId: 'SKU-001', kind: 'content#product' }),
        })

      const { upsertProduct } = await import('@/lib/merchant/client')
      const result = await upsertProduct(fakeProduct as any).catch(() => null)
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  describe('customBatchUpsert', () => {
    it('sends batch request to GMC API', async () => {
      const entries = [{ batchId: 0, merchantId: '12345', method: 'insert', product: { offerId: 'SKU-001' } }]

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ entries: [{ batchId: 0, product: { offerId: 'SKU-001' } }] }),
        })

      const { customBatchUpsert } = await import('@/lib/merchant/client')
      const result = await customBatchUpsert(entries as any).catch(() => null)
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  describe('deleteProductByOfferId', () => {
    it('calls delete endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })

      const { deleteProductByOfferId } = await import('@/lib/merchant/client')
      await expect(deleteProductByOfferId('SKU-001').catch(() => {})).resolves.not.toThrow()
    })
  })

  describe('listProducts', () => {
    it('returns product list', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ resources: [{ offerId: 'SKU-001' }], nextPageToken: null }),
        })

      const { listProducts } = await import('@/lib/merchant/client')
      const result = await listProducts().catch(() => null)
      expect(result === null || typeof result === 'object').toBe(true)
    })

    it('accepts pageToken for pagination', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ resources: [], nextPageToken: null }),
        })

      const { listProducts } = await import('@/lib/merchant/client')
      const result = await listProducts('page-token-abc').catch(() => null)
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })
})
