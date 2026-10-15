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

const tokenRes = { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
const okRes = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body })
const failRes = (status: number, body: unknown) => ({ ok: false, status, text: async () => JSON.stringify(body) })

// Token requests go to oauth2; everything else is routed by the test.
function routeFetch(handler: (url: string, opts: any) => any) {
  mockFetch.mockImplementation(async (url: string, opts: any) =>
    url === 'https://oauth2.googleapis.com/token' ? tokenRes : handler(url, opts)
  )
}
const apiCalls = () => mockFetch.mock.calls.filter(c => c[0] !== 'https://oauth2.googleapis.com/token')

const DS = 'accounts/12345/dataSources/777'
// base64url('en~IN~SKU/1')
const SKU_ID = Buffer.from('en~IN~SKU/1').toString('base64url')

describe('merchant/client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockFetch.mockReset()
    mockResolveGoogleMerchantCreds.mockResolvedValue({ ...CREDS })
  })

  describe('getAccessToken', () => {
    it('returns a token using the resolved service-account credentials', async () => {
      mockFetch.mockResolvedValueOnce(okRes({ access_token: 'test-token-123', expires_in: 3600 }))
      const { getAccessToken } = await import('@/lib/merchant/client')
      expect(await getAccessToken()).toBe('test-token-123')
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('https://oauth2.googleapis.com/token')
      expect(opts.body).toContain('grant-type:jwt-bearer')
    })

    it('caches the token per resolved account (second call does not re-fetch)', async () => {
      mockFetch.mockResolvedValueOnce(okRes({ access_token: 'cached-tok', expires_in: 3600 }))
      const { getAccessToken } = await import('@/lib/merchant/client')
      expect(await getAccessToken()).toBe(await getAccessToken())
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('throws when the auth response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce(okRes({ error: 'invalid_grant' }))
      const { getAccessToken } = await import('@/lib/merchant/client')
      await expect(getAccessToken()).rejects.toThrow(/GMC auth failed/)
    })
  })

  describe('merchantApiRequest', () => {
    it('calls merchantapi.googleapis.com with the bearer token', async () => {
      routeFetch(() => okRes({ products: [] }))
      const { merchantApiRequest } = await import('@/lib/merchant/client')
      await merchantApiRequest('GET', '/products/v1/accounts/12345/products')
      const [url, opts] = apiCalls()[0]
      expect(url).toBe('https://merchantapi.googleapis.com/products/v1/accounts/12345/products')
      expect(opts.headers.Authorization).toBe('Bearer tok')
    })

    it('retries 429/5xx with backoff and returns the later success', async () => {
      const responses = [failRes(429, { error: { message: 'quota' } }), failRes(503, {}), okRes({ ok: 1 })]
      routeFetch(() => responses.shift())
      const { merchantApiRequest } = await import('@/lib/merchant/client')
      expect(await merchantApiRequest('GET', '/x', { delays: [0, 0] })).toEqual({ ok: 1 })
      expect(apiCalls()).toHaveLength(3)
    })

    it('does not retry a 400 and keeps only the Google message', async () => {
      routeFetch(() => failRes(400, { error: { message: 'Invalid  value\n[price]' } }))
      const { merchantApiRequest } = await import('@/lib/merchant/client')
      await expect(merchantApiRequest('POST', '/x', { delays: [0] })).rejects.toThrow('HTTP 400: Invalid value [price]')
      expect(apiCalls()).toHaveLength(1)
    })

    it('explains a permission failure with the service account and merchant id', async () => {
      routeFetch(() => failRes(403, { error: { message: 'The caller does not have permission' } }))
      const { merchantApiRequest } = await import('@/lib/merchant/client')
      await expect(merchantApiRequest('GET', '/x')).rejects.toThrow(
        /HTTP 403: The caller does not have permission — the service account test@project\.iam\.gserviceaccount\.com has no access to Merchant Center account 12345/
      )
    })
  })

  describe('resolveDataSource', () => {
    it('uses the configured data source (bare id or full name) without calling Google', async () => {
      mockResolveGoogleMerchantCreds.mockResolvedValue({ ...CREDS, dataSource: '777' })
      const { resolveDataSource } = await import('@/lib/merchant/client')
      expect(await resolveDataSource()).toBe(DS)
      mockResolveGoogleMerchantCreds.mockResolvedValue({ ...CREDS, dataSource: DS })
      expect(await resolveDataSource()).toBe(DS)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('finds an existing primary API data source and caches it', async () => {
      routeFetch(() =>
        okRes({
          dataSources: [
            { name: 'accounts/12345/dataSources/1', input: 'FILE', primaryProductDataSource: {} },
            { name: 'accounts/12345/dataSources/2', input: 'API', supplementalProductDataSource: {} },
            {
              name: 'accounts/12345/dataSources/3',
              input: 'API',
              primaryProductDataSource: { feedLabel: 'US', contentLanguage: 'en' },
            },
            { name: DS, input: 'API', primaryProductDataSource: { feedLabel: 'IN', contentLanguage: 'en' } },
          ],
        })
      )
      const { resolveDataSource } = await import('@/lib/merchant/client')
      expect(await resolveDataSource()).toBe(DS)
      expect(await resolveDataSource()).toBe(DS)
      expect(apiCalls()).toHaveLength(1)
      expect(apiCalls()[0][0]).toBe(
        'https://merchantapi.googleapis.com/datasources/v1/accounts/12345/dataSources?pageSize=1000'
      )
    })

    it('creates a primary API data source when none exists', async () => {
      routeFetch((url, opts) => (opts.method === 'POST' ? okRes({ name: DS }) : okRes({ dataSources: [] })))
      const { resolveDataSource } = await import('@/lib/merchant/client')
      expect(await resolveDataSource()).toBe(DS)
      const [url, opts] = apiCalls()[1]
      expect(url).toBe('https://merchantapi.googleapis.com/datasources/v1/accounts/12345/dataSources')
      expect(JSON.parse(opts.body)).toEqual({
        displayName: 'Jeffi Stores API',
        primaryProductDataSource: { contentLanguage: 'en', feedLabel: 'IN', countries: ['IN'] },
      })
    })

    it('says clearly when the account refuses access', async () => {
      routeFetch(() => failRes(403, { error: { message: 'denied' } }))
      const { resolveDataSource } = await import('@/lib/merchant/client')
      await expect(resolveDataSource()).rejects.toThrow(
        /Could not find or create the Merchant API data source: HTTP 403: denied — .*People and access/
      )
    })
  })

  describe('products', () => {
    it('insertProductInput posts to productInputs:insert with the dataSource param', async () => {
      routeFetch(() => okRes({ name: 'accounts/12345/productInputs/x' }))
      const { insertProductInput } = await import('@/lib/merchant/client')
      const input = { offerId: 'SKU-1', contentLanguage: 'en', feedLabel: 'IN', productAttributes: { title: 'T' } }
      await insertProductInput(input, { dataSource: DS })
      const [url, opts] = apiCalls()[0]
      expect(url).toBe(
        `https://merchantapi.googleapis.com/products/v1/accounts/12345/productInputs:insert?dataSource=${encodeURIComponent(DS)}`
      )
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toEqual(input)
    })

    it('upsertProduct resolves the data source first', async () => {
      mockResolveGoogleMerchantCreds.mockResolvedValue({ ...CREDS, dataSource: '777' })
      routeFetch(() => okRes({}))
      const { upsertProduct } = await import('@/lib/merchant/client')
      await upsertProduct({ offerId: 'A' })
      expect(apiCalls()[0][0]).toContain(`productInputs:insert?dataSource=${encodeURIComponent(DS)}`)
    })

    it('deleteProductByOfferId deletes the encoded product input and ignores 404', async () => {
      routeFetch(() => failRes(404, { error: { message: 'not found' } }))
      const { deleteProductByOfferId } = await import('@/lib/merchant/client')
      await expect(deleteProductByOfferId('SKU/1', DS)).resolves.toBeUndefined()
      const [url, opts] = apiCalls()[0]
      expect(url).toBe(
        `https://merchantapi.googleapis.com/products/v1/accounts/12345/productInputs/${SKU_ID}?dataSource=${encodeURIComponent(DS)}`
      )
      expect(opts.method).toBe('DELETE')
    })

    it('deleteProductByOfferId surfaces other failures', async () => {
      routeFetch(() => failRes(400, { error: { message: 'bad' } }))
      const { deleteProductByOfferId } = await import('@/lib/merchant/client')
      await expect(deleteProductByOfferId('A', DS)).rejects.toThrow('HTTP 400: bad')
    })

    it('listProducts pages processed products', async () => {
      routeFetch(() => okRes({ products: [{ offerId: 'A' }], nextPageToken: 'n2' }))
      const { listProducts } = await import('@/lib/merchant/client')
      const res = await listProducts('p1')
      expect(res.products).toEqual([{ offerId: 'A' }])
      expect(apiCalls()[0][0]).toBe(
        'https://merchantapi.googleapis.com/products/v1/accounts/12345/products?pageSize=1000&pageToken=p1'
      )
    })

    it('getProduct returns the processed product, or null when missing', async () => {
      routeFetch(() => okRes({ offerId: 'SKU/1', productStatus: {} }))
      const { getProduct } = await import('@/lib/merchant/client')
      expect(await getProduct('SKU/1')).toEqual({ offerId: 'SKU/1', productStatus: {} })
      expect(apiCalls()[0][0]).toBe(`https://merchantapi.googleapis.com/products/v1/accounts/12345/products/${SKU_ID}`)
      routeFetch(() => failRes(404, {}))
      expect(await getProduct('nope')).toBeNull()
    })
  })
})
