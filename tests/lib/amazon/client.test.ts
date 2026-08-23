import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const LWA_ENV = {
  AMAZON_LWA_CLIENT_ID: 'cid',
  AMAZON_LWA_CLIENT_SECRET: 'secret',
  AMAZON_LWA_REFRESH_TOKEN: 'rtok',
}

function setLwaEnv() {
  process.env.AMAZON_LWA_CLIENT_ID = LWA_ENV.AMAZON_LWA_CLIENT_ID
  process.env.AMAZON_LWA_CLIENT_SECRET = LWA_ENV.AMAZON_LWA_CLIENT_SECRET
  process.env.AMAZON_LWA_REFRESH_TOKEN = LWA_ENV.AMAZON_LWA_REFRESH_TOKEN
}

function clearLwaEnv() {
  delete process.env.AMAZON_LWA_CLIENT_ID
  delete process.env.AMAZON_LWA_CLIENT_SECRET
  delete process.env.AMAZON_LWA_REFRESH_TOKEN
  delete process.env.AMAZON_SELLER_ID
  delete process.env.AMAZON_MARKETPLACE_ID
}

function tokenResponse(token = 'access-tok', expires = 3600) {
  return { ok: true, status: 200, json: async () => ({ access_token: token, expires_in: expires }) }
}

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => '' },
  }
}

function errorResponse(status: number, text = 'boom', headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    text: async () => text,
    json: async () => ({}),
    headers: { get: (k: string) => headers[k] || '' },
  }
}

describe('amazon/client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    clearLwaEnv()
    setLwaEnv()
  })

  describe('exports', () => {
    it('exposes expected functions', async () => {
      const mod = await import('@/lib/amazon/client')
      expect(typeof mod.getAccessToken).toBe('function')
      expect(typeof mod.spApiRequest).toBe('function')
      expect(typeof mod.putListingsItem).toBe('function')
      expect(typeof mod.patchListingsItem).toBe('function')
      expect(typeof mod.validateListingsItem).toBe('function')
      expect(typeof mod.deleteListingsItem).toBe('function')
      expect(typeof mod.getListingsItem).toBe('function')
      expect(typeof mod.searchListingsItems).toBe('function')
      expect(typeof mod.searchCatalogItems).toBe('function')
      expect(typeof mod.matchAsin).toBe('function')
      expect(typeof mod.getListingsRestrictions).toBe('function')
      // MARKETPLACE_ID/SELLER_ID are no longer static exports — they resolve per-tenant
      // at call time via getMarketplaceId()/getSellerId().
      expect(typeof mod.getMarketplaceId).toBe('function')
      expect(typeof mod.getSellerId).toBe('function')
    })

    it('getMarketplaceId/getSellerId resolve from env creds when no tenant context', async () => {
      process.env.AMAZON_SELLER_ID = 'SELLER-XYZ'
      const { getMarketplaceId, getSellerId } = await import('@/lib/amazon/client')
      expect(await getMarketplaceId()).toBe('A21TJRUUN4KGV')
      expect(await getSellerId()).toBe('SELLER-XYZ')
    })
  })

  describe('getAccessToken', () => {
    it('fetches a token when none cached', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('tok-1'))
      const { getAccessToken } = await import('@/lib/amazon/client')
      const tok = await getAccessToken()
      expect(tok).toBe('tok-1')
    })

    it('returns cached token on second call', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('tok-cache', 3600))
      const { getAccessToken } = await import('@/lib/amazon/client')
      const t1 = await getAccessToken()
      const t2 = await getAccessToken()
      expect(t1).toBe(t2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('throws when credentials missing', async () => {
      clearLwaEnv()
      const { getAccessToken } = await import('@/lib/amazon/client')
      await expect(getAccessToken()).rejects.toThrow(/credentials missing/)
    })

    it('throws when auth response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }))
      const { getAccessToken } = await import('@/lib/amazon/client')
      await expect(getAccessToken()).rejects.toThrow(/LWA auth failed/)
    })
  })

  describe('spApiRequest', () => {
    it('makes an authenticated GET and returns json', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ ok: true, data: 1 }))
      const { spApiRequest } = await import('@/lib/amazon/client')
      const res = await spApiRequest('GET', '/some/path', { query: { a: '1', b: undefined, c: '' } })
      expect(res).toEqual({ ok: true, data: 1 })
      // Second call = the SP-API request
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('a=1')
      expect(url).not.toContain('b=')
      expect(url).not.toContain('c=')
    })

    it('sends body when provided', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ done: true }))
      const { spApiRequest } = await import('@/lib/amazon/client')
      await spApiRequest('PUT', '/p', { body: { hello: 'world' } })
      const opts = mockFetch.mock.calls[1][1] as any
      expect(opts.body).toBe(JSON.stringify({ hello: 'world' }))
    })

    it('returns null on 204', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null, headers: { get: () => '' } })
      const { spApiRequest } = await import('@/lib/amazon/client')
      const res = await spApiRequest('DELETE', '/p')
      expect(res).toBeNull()
    })

    it('throws with status/retryAfter/rateLimit on non-ok', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(errorResponse(429, 'rate limited', {
          'Retry-After': '5',
          'x-amzn-RateLimit-Limit': '2.0',
        }))
      const { spApiRequest } = await import('@/lib/amazon/client')
      await expect(spApiRequest('GET', '/p')).rejects.toMatchObject({
        status: 429,
        retryAfter: '5',
        rateLimit: '2.0',
      })
    })

    it('handles error with no query and no headers gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(errorResponse(500, 'server error'))
      const { spApiRequest } = await import('@/lib/amazon/client')
      await expect(spApiRequest('GET', '/p')).rejects.toThrow(/failed \(500\)/)
    })
  })

  describe('listings item wrappers', () => {
    async function withToken(body: any, status = 200) {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse(body, status))
      return import('@/lib/amazon/client')
    }

    it('putListingsItem PUTs the listing', async () => {
      const { putListingsItem } = await withToken({ status: 'ACCEPTED' })
      const res = await putListingsItem('SKU-1', { productType: 'BOLTS' })
      expect(res).toEqual({ status: 'ACCEPTED' })
      const [url, opts] = mockFetch.mock.calls[1]
      expect(opts.method).toBe('PUT')
      expect(url).toContain('/listings/2021-08-01/items/')
      expect(url).toContain('SKU-1')
    })

    it('patchListingsItem PATCHes', async () => {
      const { patchListingsItem } = await withToken({ status: 'ACCEPTED' })
      await patchListingsItem('SKU-1', 'BOLTS', [{ op: 'replace', path: '/x', value: 1 }])
      const opts = mockFetch.mock.calls[1][1] as any
      expect(opts.method).toBe('PATCH')
      expect(opts.body).toContain('productType')
    })

    it('validateListingsItem adds VALIDATION_PREVIEW mode', async () => {
      const { validateListingsItem } = await withToken({ issues: [] })
      await validateListingsItem('SKU-1', { productType: 'BOLTS' })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('mode=VALIDATION_PREVIEW')
    })

    it('getListingsItem GETs with includedData', async () => {
      const { getListingsItem } = await withToken({ sku: 'SKU-1' })
      const res = await getListingsItem('SKU-1')
      expect(res).toEqual({ sku: 'SKU-1' })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('includedData=summaries')
    })

    it('searchListingsItems passes pageToken', async () => {
      const { searchListingsItems } = await withToken({ items: [], pagination: {} })
      await searchListingsItems('next-1')
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('pageToken=next-1')
    })

    it('searchListingsItems works without pageToken', async () => {
      const { searchListingsItems } = await withToken({ items: [] })
      const res = await searchListingsItems()
      expect(res).toEqual({ items: [] })
    })

    it('deleteListingsItem swallows 404', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(errorResponse(404, 'not found'))
      const { deleteListingsItem } = await import('@/lib/amazon/client')
      await expect(deleteListingsItem('SKU-1')).resolves.toBeUndefined()
    })

    it('deleteListingsItem rethrows non-404', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(errorResponse(500, 'oops'))
      const { deleteListingsItem } = await import('@/lib/amazon/client')
      await expect(deleteListingsItem('SKU-1')).rejects.toThrow()
    })

    it('deleteListingsItem succeeds on 204', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null, headers: { get: () => '' } })
      const { deleteListingsItem } = await import('@/lib/amazon/client')
      await expect(deleteListingsItem('SKU-1')).resolves.toBeUndefined()
    })
  })

  describe('searchCatalogItems', () => {
    it('sets identifiersType only when identifiers present', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ items: [] }))
      const { searchCatalogItems } = await import('@/lib/amazon/client')
      await searchCatalogItems({ identifiers: '012345678905', identifiersType: 'UPC' })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('identifiersType=UPC')
    })

    it('omits identifiersType when only keywords given, defaults pageSize', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ items: [] }))
      const { searchCatalogItems } = await import('@/lib/amazon/client')
      await searchCatalogItems({ keywords: 'hex bolt', identifiersType: 'UPC' })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).not.toContain('identifiersType')
      expect(url).toContain('pageSize=10')
    })

    it('honors explicit pageSize', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ items: [] }))
      const { searchCatalogItems } = await import('@/lib/amazon/client')
      await searchCatalogItems({ keywords: 'x', pageSize: 5 })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('pageSize=5')
    })
  })

  describe('getListingsRestrictions', () => {
    it('sends asin + default conditionType', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ restrictions: [] }))
      const { getListingsRestrictions } = await import('@/lib/amazon/client')
      const res = await getListingsRestrictions('B0ASIN')
      expect(res).toEqual({ restrictions: [] })
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('asin=B0ASIN')
      expect(url).toContain('conditionType=new_new')
    })

    it('accepts custom conditionType', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ restrictions: [] }))
      const { getListingsRestrictions } = await import('@/lib/amazon/client')
      await getListingsRestrictions('B0ASIN', 'used_good')
      const url = mockFetch.mock.calls[1][0] as string
      expect(url).toContain('conditionType=used_good')
    })
  })

  describe('matchAsin', () => {
    it('returns gtin match when gtin lookup hits (12-digit UPC)', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0GTIN', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'X', brand: 'Acme' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ gtin: '012345678905', name: 'anything' })
      expect(res).toMatchObject({ asin: 'B0GTIN', matchType: 'gtin' })
    })

    it('uses EAN type for 13-digit gtin', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0EAN', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'X' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ gtin: '0123456789012', name: 'x' })
      expect(res?.asin).toBe('B0EAN')
      const gtinUrl = mockFetch.mock.calls[1][0] as string
      expect(gtinUrl).toContain('identifiersType=EAN')
    })

    it('returns null when no keyword and no gtin', async () => {
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: '' })
      expect(res).toBeNull()
      // no fetch beyond nothing (kw empty so returns before search)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('falls through to keyword search when gtin lookup misses', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        // gtin lookup returns no items
        .mockResolvedValueOnce(jsonResponse({ items: [] }))
        // keyword search returns a strong match
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0KW', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Hex Bolt M12', brand: 'Acme' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ gtin: '012345678905', name: 'Hex Bolt M12', brand: 'Acme' })
      expect(res).toMatchObject({ asin: 'B0KW', matchType: 'keyword' })
    })

    it('does keyword-only search when gtin too short', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0KW2', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Hex Bolt M12' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ gtin: '123', name: 'Hex Bolt M12', mpn: 'KM9V' })
      expect(res?.asin).toBe('B0KW2')
    })

    it('filters out candidates whose brand differs', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0WRONG', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Hex Bolt M12', brand: 'OtherBrand' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Hex Bolt M12', brand: 'Acme' })
      expect(res).toBeNull()
    })

    it('skips candidates without asin', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Hex Bolt M12' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Hex Bolt M12' })
      expect(res).toBeNull()
    })

    it('returns null when spec tokens disagree (size mismatch)', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0M4', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Hex Bolt M4' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      // our name M12, candidate M4 -> size mismatch -> hard reject -> null
      const res = await matchAsin({ name: 'Hex Bolt M12' })
      expect(res).toBeNull()
    })

    it('picks highest scoring candidate with model + pack agreement', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [
            { asin: 'B0LOW', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Screw M6 16mm' }] },
            { asin: 'B0HIGH', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Screw M6 16mm KM9V set of 13' }] },
          ],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Screw M6 16mm KM9V 13pc' })
      expect(res?.asin).toBe('B0HIGH')
    })

    it('rejects when pack counts disagree', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0PACK', summaries: [{ marketplaceId: 'A21TJRUUN4KGV', itemName: 'Screwdriver set of 9' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Screwdriver 13pc' })
      expect(res).toBeNull()
    })

    it('handles empty items array from keyword search', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({}))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Hex Bolt M12' })
      expect(res).toBeNull()
    })

    it('uses summaries[0] fallback when no marketplace match in toCatalogMatch', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          items: [{ asin: 'B0FB', summaries: [{ marketplaceId: 'OTHER', itemName: 'Hex Bolt M12', brandName: 'Acme' }] }],
        }))
      const { matchAsin } = await import('@/lib/amazon/client')
      const res = await matchAsin({ name: 'Hex Bolt M12' })
      expect(res?.asin).toBe('B0FB')
    })
  })
})
